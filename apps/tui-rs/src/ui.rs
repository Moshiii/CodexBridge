use ratatui::backend::Backend;
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap,
};
use ratatui::{Frame, Terminal};

use crate::app::App;
use crate::footer::render_footer;

pub fn draw<B: Backend>(terminal: &mut Terminal<B>, app: &mut App) -> anyhow::Result<()> {
    terminal.draw(|frame| render(frame, app))?;
    Ok(())
}

fn render(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Min(8),
            Constraint::Length(1),
            Constraint::Length(2),
            Constraint::Length(3),
        ])
        .split(area);

    render_transcript(frame, chunks[0], app);
    render_status_line(frame, chunks[1], app);
    render_footer(frame, chunks[2], &app.status);
    render_composer(frame, chunks[3], app);
}

fn render_transcript(frame: &mut Frame, area: Rect, app: &mut App) {
    let block = Block::default().borders(Borders::NONE);
    let inner = block.inner(area);
    let inner = inner.inner(Margin {
        vertical: 0,
        horizontal: 1,
    });
    let visible_lines = app.history.visible_lines(inner.height as usize);

    let transcript = Paragraph::new(visible_lines)
        .block(block)
        .wrap(Wrap { trim: false });
    frame.render_widget(transcript, area);

    let (position, total) = app.history.scrollbar_position(inner.height as usize);
    let mut state = ScrollbarState::new(total).position(position);
    let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
        .thumb_symbol("█")
        .track_symbol(Some("│"))
        .begin_symbol(None)
        .end_symbol(None)
        .style(Style::default().fg(Color::DarkGray));
    frame.render_stateful_widget(scrollbar, area, &mut state);
}

fn render_status_line(frame: &mut Frame, area: Rect, app: &App) {
    let text = Line::from(vec![
        Span::styled(
            format!("Following live transcript  ·  thread {}", app.current_thread_id),
            Style::default().fg(Color::Gray).add_modifier(Modifier::DIM),
        ),
        Span::raw("  "),
        Span::styled(
            app.status.message.as_str(),
            Style::default().fg(Color::DarkGray),
        ),
    ]);
    frame.render_widget(Paragraph::new(text), area);
}

fn render_composer(frame: &mut Frame, area: Rect, app: &App) {
    let input = Paragraph::new(Line::from(vec![
        Span::styled(
            "Goal: ",
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(app.composer.input().to_string()),
    ]))
    .block(
        Block::default()
            .style(Style::default().bg(Color::DarkGray))
            .borders(Borders::NONE),
    )
    .wrap(Wrap { trim: false });
    frame.render_widget(input, area);

    let cursor_x = area.x + 7 + app.composer.input().chars().count() as u16;
    let cursor_y = area.y + 1;
    frame.set_cursor_position((cursor_x, cursor_y));
}
