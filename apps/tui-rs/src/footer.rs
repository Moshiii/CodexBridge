use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::composer::FooterMode;
use crate::history::StatusSummary;

pub fn render_footer(frame: &mut Frame, area: Rect, status: &StatusSummary) {
    let lines = match status.footer_mode {
        FooterMode::ShortcutOverlay => vec![
            Line::from(vec![
                Span::styled("Enter", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" submit  "),
                Span::styled("PgUp/PgDn", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" scroll  "),
                Span::styled("Home/End", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" top/tail"),
            ]),
            Line::from(vec![
                Span::styled("Esc", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" clear  "),
                Span::styled("Ctrl+C", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" quit  "),
                Span::styled("?", Style::default().add_modifier(Modifier::BOLD)),
                Span::raw(" close shortcuts"),
            ]),
        ],
        FooterMode::EscHint => vec![Line::from(
            "Esc clears the composer. Ctrl+C quits when empty.",
        )],
        FooterMode::HasDraft => vec![Line::from(vec![
            Span::raw("Draft ready  "),
            Span::styled("Enter", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" submit  "),
            Span::styled("/", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" commands  "),
            Span::styled("PgUp/PgDn", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" scroll"),
        ])],
        FooterMode::Empty => vec![
            Line::from(format!(
                "manager {}  tasks {}  workers {}  busy {}  alerts {}  reminders {}",
                status.manager,
                status.tasks,
                status.workers,
                status.busy,
                status.alerts,
                status.reminders
            )),
            Line::from(
                "/ for commands  ctrl+p history  pgup/pgdn scroll  ctrl+c quit  ? shortcuts",
            ),
        ],
    };

    let paragraph = Paragraph::new(lines).style(Style::default().fg(Color::Gray));
    frame.render_widget(paragraph, area);
}
