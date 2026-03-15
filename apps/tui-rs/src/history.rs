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

    pub fn scroll_up(&mut self, by: usize, height: usize, width: usize) {
        let max_start = self.max_start(height, width);
        self.follow_tail = false;
        if self.scroll >= max_start {
            self.scroll = max_start.saturating_sub(by);
        } else {
            self.scroll = self.scroll.saturating_sub(by);
        }
    }

    pub fn scroll_down(&mut self, by: usize, height: usize, width: usize) {
        let max_start = self.max_start(height, width);
        self.scroll = self.scroll.saturating_add(by).min(max_start);
        self.follow_tail = self.scroll >= max_start;
    }

    pub fn jump_top(&mut self, _height: usize, _width: usize) {
        self.follow_tail = false;
        self.scroll = 0;
    }

    pub fn jump_to_ratio(&mut self, ratio: f32, height: usize, width: usize) {
        let max_start = self.max_start(height, width);
        if max_start == 0 {
            self.scroll = 0;
            self.follow_tail = true;
            return;
        }
        let clamped = ratio.clamp(0.0, 1.0);
        self.scroll = ((max_start as f32) * clamped).round() as usize;
        self.follow_tail = self.scroll >= max_start;
    }

    pub fn follow_tail(&mut self) {
        self.follow_tail = true;
    }

    pub fn visible_lines(&self, height: usize, width: usize) -> Vec<Line<'static>> {
        let all = self.all_lines(width);
        if all.len() <= height {
            return all;
        }
        if self.follow_tail {
            return all[all.len().saturating_sub(height)..].to_vec();
        }
        let max_start = all.len().saturating_sub(height);
        let start = self.scroll.min(max_start);
        all[start..start + height].to_vec()
    }

    pub fn scrollbar_position(&self, height: usize, width: usize) -> (usize, usize) {
        let total = self.all_lines(width).len().max(1);
        let viewport = height.max(1).min(total);
        let max_start = total.saturating_sub(viewport);
        let position = if self.follow_tail {
            max_start
        } else {
            self.scroll.min(max_start)
        };
        (position, total)
    }

    fn max_start(&self, height: usize, width: usize) -> usize {
        self.all_lines(width).len().saturating_sub(height)
    }

    fn all_lines(&self, width: usize) -> Vec<Line<'static>> {
        let mut lines = Vec::new();
        for cell in &self.committed {
            lines.extend(format_cell(cell, width));
            lines.push(Line::from(""));
        }
        if let Some(cell) = &self.active {
            lines.extend(format_cell(cell, width));
        } else if !lines.is_empty() {
            lines.pop();
        }
        lines
    }
}

fn format_cell(cell: &BridgeCell, width: usize) -> Vec<Line<'static>> {
    let kind = cell.kind.as_str();
    let label = cell.label.as_deref().unwrap_or(kind);
    match kind {
        "user" => render_block(
            "You",
            &cell.body,
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
            width,
        ),
        "assistant" => {
            let header = if cell.status.as_deref() == Some("streaming") {
                format!("{label} thinking")
            } else {
                label.to_string()
            };
            render_block(
                &header,
                &cell.body,
                Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                width,
            )
        }
        "plan" => render_plan_block(label, &cell.body, width),
        "tool_call" | "command" | "file_change" => render_block(
            label,
            &cell.body,
            Style::default().fg(Color::Blue).add_modifier(Modifier::BOLD),
            width,
        ),
        "warning" => render_block(
            label,
            &cell.body,
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
            width,
        ),
        "status" | "system" => render_status_block(label, &cell.body, width),
        _ => render_block(
            label,
            &cell.body,
            Style::default().fg(Color::Gray).add_modifier(Modifier::BOLD),
            width,
        ),
    }
}

fn render_plan_block(label: &str, body: &str, width: usize) -> Vec<Line<'static>> {
    let content_width = width.saturating_sub(6).max(10);
    let mut lines = vec![Line::from(vec![
        Span::styled(
            label.to_string(),
            Style::default()
                .fg(Color::Magenta)
                .add_modifier(Modifier::BOLD),
        ),
    ])];

    let items = body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    if items.is_empty() {
        lines.push(Line::from(vec![Span::styled(
            "  • pending",
            Style::default().fg(Color::White),
        )]));
        return lines;
    }

    for item in items {
        let normalized = item
            .trim_start_matches("- ")
            .trim_start_matches("* ")
            .trim_start_matches("• ")
            .trim();
        let wrapped = wrap_plain_lines(normalized, content_width);
        if let Some(first) = wrapped.first() {
            lines.push(Line::from(vec![
                Span::styled("  • ", Style::default().fg(Color::Magenta)),
                Span::styled(first.clone(), Style::default().fg(Color::White)),
            ]));
        }
        for segment in wrapped.into_iter().skip(1) {
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(segment, Style::default().fg(Color::White)),
            ]));
        }
    }

    lines
}

fn render_status_block(label: &str, body: &str, width: usize) -> Vec<Line<'static>> {
    let available = width.saturating_sub(2).max(8);
    let show_label = !matches!(label, "event" | "system" | "status");
    wrap_plain_lines(body, available)
        .into_iter()
        .enumerate()
        .map(|(index, segment)| {
            if index == 0 {
                if show_label {
                    Line::from(vec![
                        Span::styled("• ", Style::default().fg(Color::DarkGray)),
                        Span::styled(label.to_string(), Style::default().fg(Color::Gray)),
                        Span::raw("  "),
                        Span::styled(segment, Style::default().fg(Color::Gray)),
                    ])
                } else {
                    Line::from(vec![
                        Span::styled("• ", Style::default().fg(Color::DarkGray)),
                        Span::styled(segment, Style::default().fg(Color::Gray)),
                    ])
                }
            } else {
                Line::from(vec![
                    Span::raw("  "),
                    Span::styled(segment, Style::default().fg(Color::Gray)),
                ])
            }
        })
        .collect()
}

fn render_block(prefix: &str, body: &str, prefix_style: Style, width: usize) -> Vec<Line<'static>> {
    let content_width = width.saturating_sub(4).max(12);
    let wrapped = truncate_wrapped_lines(wrap_plain_lines(body, content_width), 8);
    let mut lines = Vec::new();
    if let Some(first) = wrapped.first() {
        lines.push(Line::from(vec![
            Span::styled(prefix.to_string(), prefix_style),
            Span::raw("  "),
            Span::styled(first.clone(), Style::default().fg(Color::White)),
        ]));
    } else {
        lines.push(Line::from(vec![Span::styled(prefix.to_string(), prefix_style)]));
    }

    for segment in wrapped.into_iter().skip(1) {
        lines.push(Line::from(vec![
            Span::styled("│", Style::default().fg(Color::DarkGray)),
            Span::raw("  "),
            Span::styled(segment, Style::default().fg(Color::White)),
        ]));
    }
    lines
}

fn truncate_wrapped_lines(lines: Vec<String>, max_lines: usize) -> Vec<String> {
    if lines.len() <= max_lines {
        return lines;
    }
    let hidden = lines.len() - (max_lines - 1);
    let mut visible = lines.into_iter().take(max_lines - 1).collect::<Vec<_>>();
    visible.push(format!("... +{hidden} more lines"));
    visible
}

fn wrap_plain_lines(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines = Vec::new();
    for source_line in text.lines() {
        if source_line.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current = String::new();
        for word in source_line.split_whitespace() {
            if current.is_empty() {
                if word.chars().count() <= width {
                    current.push_str(word);
                } else {
                    push_long_word(word, width, &mut lines);
                }
                continue;
            }
            let candidate_len = current.chars().count() + 1 + word.chars().count();
            if candidate_len <= width {
                current.push(' ');
                current.push_str(word);
            } else {
                lines.push(current);
                current = String::new();
                if word.chars().count() <= width {
                    current.push_str(word);
                } else {
                    push_long_word(word, width, &mut lines);
                }
            }
        }
        if !current.is_empty() {
            lines.push(current);
        }
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn push_long_word(word: &str, width: usize, out: &mut Vec<String>) {
    let mut current = String::new();
    for ch in word.chars() {
        current.push(ch);
        if current.chars().count() >= width {
            out.push(current);
            current = String::new();
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
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
    use ratatui::text::Line;

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

        let lines = history.visible_lines(8, 60);
        assert!(lines.iter().any(|line| line.to_string().contains("streaming")));
    }

    #[test]
    fn page_up_moves_off_tail() {
        let mut history = HistoryState::new();
        for idx in 0..20 {
            history.push_cell(BridgeCell {
                id: idx.to_string(),
                kind: "status".to_string(),
                label: Some("event".to_string()),
                body: format!("line {idx}"),
                status: Some("final".to_string()),
            });
        }
        history.scroll_up(5, 6, 40);
        assert!(!history.follow_tail);
        let lines = history.visible_lines(6, 40);
        assert!(!lines.iter().any(|line| line.to_string().contains("line 19")));
        assert!(lines.iter().any(|line| line.to_string().contains("line 1")));
    }

    #[test]
    fn jump_to_ratio_reaches_tail_at_one() {
        let mut history = HistoryState::new();
        for idx in 0..30 {
            history.push_cell(BridgeCell {
                id: idx.to_string(),
                kind: "status".to_string(),
                label: Some("event".to_string()),
                body: format!("line {idx}"),
                status: Some("final".to_string()),
            });
        }

        history.jump_to_ratio(1.0, 6, 40);

        assert!(history.follow_tail);
        let lines = history.visible_lines(6, 40);
        assert!(lines.iter().any(|line| line.to_string().contains("line 29")));
    }

    #[test]
    fn plan_cells_render_as_bullets() {
        let mut history = HistoryState::new();
        history.push_cell(BridgeCell {
            id: "plan-1".to_string(),
            kind: "plan".to_string(),
            label: Some("plan".to_string()),
            body: "Create task graph\nAssign worker\nReport progress".to_string(),
            status: Some("final".to_string()),
        });

        let lines: Vec<Line<'static>> = history.visible_lines(10, 60);
        assert!(lines.iter().any(|line| line.to_string().contains("• Create task graph")));
        assert!(lines.iter().any(|line| line.to_string().contains("• Assign worker")));
    }

    #[test]
    fn long_blocks_are_truncated() {
        let mut history = HistoryState::new();
        history.push_cell(BridgeCell {
            id: "tool-1".to_string(),
            kind: "tool_call".to_string(),
            label: Some("assign worker".to_string()),
            body: (0..20)
                .map(|idx| format!("line {idx}"))
                .collect::<Vec<_>>()
                .join("\n"),
            status: Some("final".to_string()),
        });

        let lines = history.visible_lines(20, 40);
        assert!(lines
            .iter()
            .any(|line| line.to_string().contains("... +")));
    }
}
