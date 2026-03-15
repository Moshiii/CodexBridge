use anyhow::Result;
use crossterm::event::{
    Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};

use crate::bridge::{
    BridgeCell, BridgeHandle, BridgeRequest, BridgeResponse, BridgeThreadSummary,
    AUTOAIDE_TUI_PROTOCOL_VERSION,
};
use crate::composer::{Composer, ComposerAction, FooterMode};
use crate::history::HistoryState;
use crate::history::StatusSummary;

pub struct App {
    pub history: HistoryState,
    pub composer: Composer,
    pub status: StatusSummary,
    pub current_thread_id: String,
    pub known_threads: Vec<BridgeThreadSummary>,
    pub should_quit: bool,
    pub transcript_width: u16,
    pub transcript_height: u16,
    pub transcript_x: u16,
    pub transcript_y: u16,
    pub transcript_scrollbar_x: u16,
    pending_thread_list_render: bool,
    bridge: BridgeHandle,
}

impl App {
    pub fn new(bridge: BridgeHandle) -> Self {
        Self {
            history: HistoryState::new(),
            composer: Composer::new(),
            status: StatusSummary::new("Starting bridge..."),
            current_thread_id: "terminal-owner-local".to_string(),
            known_threads: Vec::new(),
            should_quit: false,
            transcript_width: 0,
            transcript_height: 0,
            transcript_x: 0,
            transcript_y: 0,
            transcript_scrollbar_x: 0,
            pending_thread_list_render: false,
            bridge,
        }
    }

    pub fn set_transcript_viewport(
        &mut self,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        scrollbar_x: u16,
    ) {
        self.transcript_x = x;
        self.transcript_y = y;
        self.transcript_width = width;
        self.transcript_height = height;
        self.transcript_scrollbar_x = scrollbar_x;
    }

    pub fn initialize(&mut self) -> Result<()> {
        self.bridge.send(&BridgeRequest::Ready {
            protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
        })
    }

    pub fn drain_bridge_events(&mut self) {
        while let Some(message) = self.bridge.try_recv() {
            self.apply_bridge_message(message);
        }
    }

    pub fn shutdown(&mut self) -> Result<()> {
        let _ = self.bridge.send(&BridgeRequest::Shutdown {
            protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
        });
        self.bridge.terminate()
    }

    pub fn handle_event(&mut self, event: Event) -> Result<()> {
        match event {
            Event::Key(key) if key.kind != KeyEventKind::Release => self.handle_key(key)?,
            Event::Mouse(mouse) => self.handle_mouse(mouse),
            Event::Paste(text) => self.composer.insert_text(&text),
            _ => {}
        }
        Ok(())
    }

    fn handle_key(&mut self, key: KeyEvent) -> Result<()> {
        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                if self.composer.is_empty() {
                    self.should_quit = true;
                } else {
                    self.composer.clear();
                    self.status.footer_mode = FooterMode::EscHint;
                    self.status.message = "Composer cleared".to_string();
                }
            }
            KeyCode::PageUp => {
                self.history
                    .scroll_up(8, self.transcript_height as usize, self.transcript_width as usize);
                self.status.message = "Scrolled transcript up".to_string();
            }
            KeyCode::PageDown => {
                self.history.scroll_down(
                    8,
                    self.transcript_height as usize,
                    self.transcript_width as usize,
                );
                self.status.message = if self.history.follow_tail {
                    "Following transcript tail".to_string()
                } else {
                    "Scrolled transcript down".to_string()
                };
            }
            KeyCode::Home => {
                self.history
                    .jump_top(self.transcript_height as usize, self.transcript_width as usize);
                self.status.message = "Showing oldest transcript lines".to_string();
            }
            KeyCode::End => {
                self.history.follow_tail();
                self.status.message = "Following transcript tail".to_string();
            }
            _ => match self.composer.handle_key(key) {
                ComposerAction::None => {}
                ComposerAction::Redraw => {
                    self.status.footer_mode = self.composer.footer_mode();
                }
                ComposerAction::Submit(text) => self.submit(text)?,
                ComposerAction::Quit => self.should_quit = true,
            },
        }
        Ok(())
    }

    fn handle_mouse(&mut self, mouse: MouseEvent) {
        let inside_transcript_rows = mouse.row >= self.transcript_y
            && mouse.row < self.transcript_y.saturating_add(self.transcript_height);
        match mouse.kind {
            MouseEventKind::ScrollUp if inside_transcript_rows => {
                self.history
                    .scroll_up(3, self.transcript_height as usize, self.transcript_width as usize);
                self.status.message = "Scrolled transcript up".to_string();
            }
            MouseEventKind::ScrollDown if inside_transcript_rows => {
                self.history.scroll_down(
                    3,
                    self.transcript_height as usize,
                    self.transcript_width as usize,
                );
                self.status.message = if self.history.follow_tail {
                    "Following transcript tail".to_string()
                } else {
                    "Scrolled transcript down".to_string()
                };
            }
            MouseEventKind::Down(MouseButton::Left)
                if inside_transcript_rows && mouse.column == self.transcript_scrollbar_x =>
            {
                let relative_row = mouse.row.saturating_sub(self.transcript_y) as f32;
                let max_row = self.transcript_height.saturating_sub(1).max(1) as f32;
                let ratio = relative_row / max_row;
                self.history.jump_to_ratio(
                    ratio,
                    self.transcript_height as usize,
                    self.transcript_width as usize,
                );
                self.status.message = if self.history.follow_tail {
                    "Following transcript tail".to_string()
                } else {
                    "Moved transcript viewport".to_string()
                };
            }
            _ => {}
        }
    }

    fn submit(&mut self, text: String) -> Result<()> {
        let value = text.trim().to_string();
        if value.is_empty() {
            self.composer.clear();
            self.status.footer_mode = self.composer.footer_mode();
            return Ok(());
        }

        if value.starts_with('/') {
            self.handle_command(&value)?;
        } else {
            self.history.set_active_cell(Some(BridgeCell {
                id: format!("working-{}", self.current_thread_id),
                kind: "assistant".to_string(),
                label: Some("working".to_string()),
                body: "Working...".to_string(),
                status: Some("streaming".to_string()),
            }));
            self.status.message = "Working...".to_string();
            self.bridge.send(&BridgeRequest::SubmitInput {
                protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
                text: value,
            })?;
        }

        self.composer.clear();
        self.status.footer_mode = self.composer.footer_mode();
        Ok(())
    }

    fn handle_command(&mut self, command: &str) -> Result<()> {
        let mut parts = command.splitn(2, ' ');
        let name = parts.next().unwrap_or_default();
        let args = parts.next().unwrap_or_default().trim();
        match name {
            "/help" => {
                self.history.push_system(
                    "Commands: /help  /threads  /new  /resume <id>  /tail  /clear  /quit  /codex-check",
                );
                self.status.message = "Showing help".to_string();
            }
            "/threads" => {
                self.pending_thread_list_render = true;
                self.bridge.send(&BridgeRequest::RequestThreads {
                    protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
                })?;
                self.status.message = "Loading saved threads".to_string();
            }
            "/new" => {
                self.bridge.send(&BridgeRequest::NewThread {
                    protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
                    thread_id: None,
                })?;
                self.status.message = "Creating new thread".to_string();
            }
            "/resume" => {
                if args.is_empty() {
                    self.history.push_warning("Usage: /resume <thread-id>");
                } else {
                    self.bridge.send(&BridgeRequest::ResumeThread {
                        protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
                        thread_id: args.to_string(),
                    })?;
                    self.status.message = format!("Resuming thread {args}");
                }
            }
            "/tail" => {
                self.history.follow_tail();
                self.status.message = "Following transcript tail".to_string();
            }
            "/clear" => {
                self.history.clear();
                self.status.message = "Conversation cleared".to_string();
            }
            "/codex-check" => {
                self.bridge.send(&BridgeRequest::SubmitInput {
                    protocol_version: AUTOAIDE_TUI_PROTOCOL_VERSION,
                    text: command.to_string(),
                })?;
            }
            "/quit" | "/exit" => {
                self.should_quit = true;
            }
            _ => {
                self.history.push_warning(format!("Unknown command: {command}"));
                self.status.message = "Unknown command".to_string();
            }
        }
        Ok(())
    }

    fn apply_bridge_message(&mut self, message: BridgeResponse) {
        match message {
            BridgeResponse::SessionState {
                conversation_id, ..
            } => {
                self.current_thread_id = conversation_id;
            }
            BridgeResponse::HistoryReset { .. } => {
                self.history.clear();
            }
            BridgeResponse::HistoryCell { cell, .. } => {
                self.history.push_cell(cell);
                self.history.follow_tail();
            }
            BridgeResponse::ActiveCellPatch { cell, .. } => {
                self.history.set_active_cell(cell);
                self.history.follow_tail();
            }
            BridgeResponse::StatusUpdate {
                message,
                manager,
                tasks,
                workers,
                busy,
                alerts,
                reminders,
                ..
            } => {
                self.status.message = message;
                self.status.manager = manager;
                self.status.tasks = tasks;
                self.status.workers = workers;
                self.status.busy = busy;
                self.status.alerts = alerts;
                self.status.reminders = reminders;
            }
            BridgeResponse::ThreadList {
                current_thread_id,
                threads,
                ..
            } => {
                self.current_thread_id = current_thread_id.clone();
                self.known_threads = threads
                    .iter()
                    .cloned()
                    .map(BridgeThreadSummary::from)
                    .collect();
                if self.pending_thread_list_render {
                    self.history.push_thread_list(
                        current_thread_id,
                        threads.into_iter().map(BridgeThreadSummary::from).collect(),
                    );
                    self.pending_thread_list_render = false;
                }
            }
            BridgeResponse::CommandResult { level, message, .. } => {
                if level == "error" {
                    self.history.push_warning(message);
                } else {
                    self.history.push_system(message);
                }
            }
            BridgeResponse::ShutdownAck { .. } => {
                self.should_quit = true;
            }
        }
    }
}
