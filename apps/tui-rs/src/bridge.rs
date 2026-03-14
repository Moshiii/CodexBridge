use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;

pub const AUTOAIDE_TUI_PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeCell {
    #[allow(dead_code)]
    pub id: String,
    pub kind: String,
    pub label: Option<String>,
    pub body: String,
    pub status: Option<String>,
}

#[derive(Clone, Debug)]
pub struct BridgeThreadSummary {
    pub id: String,
    pub turn_count: usize,
    #[allow(dead_code)]
    pub updated_at: Option<u64>,
    pub preview: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum BridgeRequest {
    #[serde(rename = "ready")]
    Ready {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
    },
    #[serde(rename = "submit_input")]
    SubmitInput {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        text: String,
    },
    #[serde(rename = "request_threads")]
    RequestThreads {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
    },
    #[serde(rename = "resume_thread")]
    ResumeThread {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "threadId")]
        thread_id: String,
    },
    #[serde(rename = "new_thread")]
    NewThread {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "threadId", skip_serializing_if = "Option::is_none")]
        thread_id: Option<String>,
    },
    #[serde(rename = "shutdown")]
    Shutdown {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeResponse {
    #[serde(rename = "session_state")]
    SessionState {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "conversationId")]
        conversation_id: String,
    },
    #[serde(rename = "history_reset")]
    HistoryReset {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
    },
    #[serde(rename = "history_cell")]
    HistoryCell {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        cell: BridgeCell,
    },
    #[serde(rename = "active_cell_patch")]
    ActiveCellPatch {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        cell: Option<BridgeCell>,
    },
    #[serde(rename = "status_update")]
    StatusUpdate {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        message: String,
        manager: usize,
        tasks: usize,
        workers: usize,
        busy: usize,
        alerts: usize,
        reminders: usize,
    },
    #[serde(rename = "thread_list")]
    ThreadList {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "currentThreadId")]
        current_thread_id: String,
        threads: Vec<BridgeThreadSummaryWire>,
    },
    #[serde(rename = "command_result")]
    CommandResult {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        level: String,
        message: String,
    },
    #[serde(rename = "shutdown_ack")]
    ShutdownAck {
        #[allow(dead_code)]
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
    },
}

#[derive(Clone, Debug, Deserialize)]
pub struct BridgeThreadSummaryWire {
    pub id: String,
    #[serde(rename = "turnCount")]
    pub turn_count: usize,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<u64>,
    pub preview: String,
}

pub struct BridgeHandle {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    rx: Receiver<BridgeResponse>,
}

impl BridgeHandle {
    pub fn spawn() -> Result<Self> {
        let mut child = Command::new("pnpm")
            .args(["exec", "tsx", "apps/tui/src/bridge.ts"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .context("failed to spawn Node bridge")?;

        let stdin = child.stdin.take().context("bridge stdin unavailable")?;
        let stdout = child.stdout.take().context("bridge stdout unavailable")?;
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                let message = match serde_json::from_str::<BridgeResponse>(&line) {
                    Ok(message) => message,
                    Err(error) => BridgeResponse::CommandResult {
                        protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
                        level: "error".to_string(),
                        message: format!("invalid bridge payload: {error}"),
                    },
                };
                let _ = tx.send(message);
            }
        });

        Ok(Self {
            child,
            stdin: BufWriter::new(stdin),
            rx,
        })
    }

    pub fn send(&mut self, request: &BridgeRequest) -> Result<()> {
        serde_json::to_writer(&mut self.stdin, request)?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        Ok(())
    }

    pub fn try_recv(&mut self) -> Option<BridgeResponse> {
        let message = self.rx.try_recv().ok()?;
        Some(match message {
            BridgeResponse::ThreadList {
                protocol_version,
                current_thread_id,
                threads,
            } => BridgeResponse::ThreadList {
                protocol_version,
                current_thread_id,
                threads,
            },
            other => other,
        })
    }

    pub fn terminate(&mut self) -> Result<()> {
        if self.child.try_wait()?.is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        Ok(())
    }
}

impl From<BridgeThreadSummaryWire> for BridgeThreadSummary {
    fn from(value: BridgeThreadSummaryWire) -> Self {
        Self {
            id: value.id,
            turn_count: value.turn_count,
            updated_at: value.updated_at,
            preview: value.preview,
        }
    }
}
