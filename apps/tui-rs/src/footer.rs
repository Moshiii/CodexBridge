use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::composer::FooterMode;
use crate::history::StatusSummary;

pub fn render_footer(frame: &mut Frame, area: Rect, status: &StatusSummary, thread_id: &str) {
    let primary_style = Style::default().fg(Color::Black);
    let secondary_style = Style::default().fg(Color::DarkGray);
    let lines = match status.footer_mode {
        FooterMode::ShortcutOverlay => vec![
            Line::from(vec![
                Span::styled(status.message.as_str(), primary_style),
            ]),
            Line::from(vec![
                Span::styled("Enter", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" send  "),
                Span::styled("PgUp/PgDn", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" scroll  "),
                Span::styled("Home/End", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" history"),
            ]),
            Line::from(vec![
                Span::styled("Esc", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" clear  "),
                Span::styled("Ctrl+C", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" quit  "),
                Span::styled("?", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" close"),
            ]),
        ],
        FooterMode::EscHint => vec![
            Line::from(vec![Span::styled(status.message.as_str(), primary_style)]),
            Line::from("Esc clears the composer. Ctrl+C quits when empty."),
            Line::from(format!("Thread {thread_id}")),
        ],
        FooterMode::HasDraft => vec![
            Line::from(vec![Span::styled(status.message.as_str(), primary_style)]),
            Line::from(vec![
                Span::raw("Draft ready  "),
                Span::styled("Enter", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" send  "),
                Span::styled("/", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" commands  "),
                Span::styled("PgUp/PgDn", primary_style.add_modifier(Modifier::BOLD)),
                Span::raw(" scroll"),
            ]),
            Line::from(format!("Thread {thread_id}")),
        ],
        FooterMode::Empty => vec![
            Line::from(vec![Span::styled(status.message.as_str(), primary_style)]),
            Line::from(format!(
                "manager {}  tasks {}  workers {}  busy {}  alerts {}  reminders {}",
                status.manager,
                status.tasks,
                status.workers,
                status.busy,
                status.alerts,
                status.reminders
            )),
            Line::from(format!(
                "/ for commands  ctrl+c quit  ? shortcuts  thread {thread_id}"
            )),
        ],
    };

    let paragraph = Paragraph::new(lines).style(secondary_style);
    frame.render_widget(paragraph, area);
}
