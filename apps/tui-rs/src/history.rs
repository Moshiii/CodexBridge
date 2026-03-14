use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};

use crate::bridge::{BridgeCell, BridgeThreadSummary};

pub struct HistoryState {
    committed: Vec<BridgeCell>,
    active: Option<BridgeCell>,
    scroll: usize,
    pub follow_tail: bool,
}

impl HistoryState {
    pub fn new() -> Self {
        Self {
            committed: Vec::new(),
            active: None,
            scroll: 0,
            follow_tail: true,
        }
    }

    pub fn push_cell(&mut self, cell: BridgeCell) {
        self.committed.push(cell);
    }

    pub fn push_system(&mut self, body: impl Into<String>) {
        self.push_cell(BridgeCell {
            id: format!("system-{}", self.committed.len() + 1),
            kind: "system".to_string(),
            label: Some("system".to_string()),
            body: body.into(),
            status: Some("final".to_string()),
        });
    }

    pub fn push_warning(&mut self, body: impl Into<String>) {
        self.push_cell(BridgeCell {
            id: format!("warning-{}", self.committed.len() + 1),
            kind: "warning".to_string(),
            label: Some("warning".to_string()),
            body: body.into(),
            status: Some("error".to_string()),
        });
    }

    pub fn push_thread_list(&mut self, current_thread_id: String, threads: Vec<BridgeThreadSummary>) {
        let body = if threads.is_empty() {
            "Saved threads:\n  (none yet)".to_string()
        } else {
            let rendered = threads
                .into_iter()
                .map(|thread| {
                    let marker = if thread.id == current_thread_id { "*" } else { " " };
                    format!(
                        "{marker} {}  turns {}  {}",
                        thread.id, thread.turn_count, thread.preview
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!("Saved threads:\n{rendered}")
        };
        self.push_system(body);
    }

    pub fn set_active_cell(&mut self, cell: Option<BridgeCell>) {
        self.active = cell;
        if self.active.is_some() {
            self.follow_tail = true;
        }
    }

    pub fn clear(&mut self) {
        self.committed.clear();
        self.active = None;
        self.scroll = 0;
        self.follow_tail = true;
    }

    pub fn scroll_up(&mut self, by: usize) {
        self.follow_tail = false;
        self.scroll = self.scroll.saturating_sub(by);
    }

    pub fn scroll_down(&mut self, by: usize) {
        let max_scroll = self.max_scroll();
        self.scroll = self.scroll.saturating_add(by).min(max_scroll);
        self.follow_tail = self.scroll >= max_scroll;
    }

    pub fn jump_top(&mut self) {
        self.follow_tail = false;
        self.scroll = 0;
    }

    pub fn follow_tail(&mut self) {
        self.follow_tail = true;
    }

    pub fn visible_lines(&self, height: usize) -> Vec<Line<'static>> {
        let all = self.all_lines();
        if all.len() <= height {
            return all;
        }
        if self.follow_tail {
            return all[all.len().saturating_sub(height)..].to_vec();
        }
        let max_scroll = all.len().saturating_sub(height);
        let start = self.scroll.min(max_scroll);
        all[start..start + height].to_vec()
    }

    pub fn scrollbar_position(&self, height: usize) -> (usize, usize) {
        let total = self.all_lines().len().max(1);
        let viewport = height.max(1).min(total);
        let position = if self.follow_tail {
            total.saturating_sub(viewport)
        } else {
            self.scroll.min(total.saturating_sub(viewport))
        };
        (position, total)
    }

    fn max_scroll(&self) -> usize {
        self.all_lines().len()
    }

    fn all_lines(&self) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        for cell in &self.committed {
            lines.extend(format_cell(cell));
            lines.push(Line::from(""));
        }
        if let Some(cell) = &self.active {
            lines.extend(format_cell(cell));
        } else if !lines.is_empty() {
            lines.pop();
        }
        lines
    }
}

fn format_cell(cell: &BridgeCell) -> Vec<Line<'static>> {
    let kind = cell.kind.as_str();
    let label = cell.label.as_deref().unwrap_or(kind);
    let status = cell.status.as_deref().unwrap_or("final");
    let style = match kind {
        "user" => Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        "assistant" => Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
        "plan" => Style::default().fg(Color::Magenta).add_modifier(Modifier::BOLD),
        "warning" => Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD),
        "tool_call" | "command" | "file_change" => {
            Style::default().fg(Color::Blue).add_modifier(Modifier::BOLD)
        }
        _ => Style::default().fg(Color::Gray).add_modifier(Modifier::BOLD),
    };
    let prefix = match kind {
        "user" => "You".to_string(),
        "assistant" if status == "streaming" => format!("{label}  streaming"),
        _ => label.to_string(),
    };
    prefixed_lines(&prefix, &cell.body, style)
}

fn prefixed_lines(prefix: &str, body: &str, prefix_style: Style) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let mut iter = body.lines();
    if let Some(first) = iter.next() {
        lines.push(Line::from(vec![
            Span::styled(format!("{prefix} "), prefix_style),
            Span::raw(first.to_string()),
        ]));
    } else {
        lines.push(Line::from(vec![Span::styled(
            format!("{prefix} "),
            prefix_style,
        )]));
    }
    for line in iter {
        lines.push(Line::from(vec![
            Span::styled("│ ", Style::default().fg(Color::DarkGray)),
            Span::raw(line.to_string()),
        ]));
    }
    lines
}

pub struct StatusSummary {
    pub message: String,
    pub manager: usize,
    pub tasks: usize,
    pub workers: usize,
    pub busy: usize,
    pub alerts: usize,
    pub reminders: usize,
    pub footer_mode: crate::composer::FooterMode,
}

impl StatusSummary {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            manager: 1,
            tasks: 0,
            workers: 0,
            busy: 0,
            alerts: 0,
            reminders: 0,
            footer_mode: crate::composer::FooterMode::Empty,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::HistoryState;
    use crate::bridge::BridgeCell;

    #[test]
    fn keeps_active_cell_at_tail() {
        let mut history = HistoryState::new();
        history.push_cell(BridgeCell {
            id: "1".to_string(),
            kind: "status".to_string(),
            label: Some("status".to_string()),
            body: "first".to_string(),
            status: Some("final".to_string()),
        });
        history.set_active_cell(Some(BridgeCell {
            id: "2".to_string(),
            kind: "assistant".to_string(),
            label: Some("manager".to_string()),
            body: "streaming".to_string(),
            status: Some("streaming".to_string()),
        }));

        let lines = history.visible_lines(8);
        assert!(lines.iter().any(|line| line.to_string().contains("streaming")));
    }
}
