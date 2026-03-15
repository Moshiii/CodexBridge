use ratatui::backend::Backend;
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
    Block, Borders, Clear, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap,
};
use ratatui::{Frame, Terminal};
use unicode_width::UnicodeWidthStr;

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
        .constraints([Constraint::Min(10), Constraint::Length(5)])
        .split(area);

    render_transcript(frame, chunks[0], app);
    render_bottom_pane(frame, chunks[1], app);
}

fn render_transcript(frame: &mut Frame, area: Rect, app: &mut App) {
    let block = Block::default().borders(Borders::NONE);
    let inner = block.inner(area);
    let inner = inner.inner(Margin {
        vertical: 0,
        horizontal: 2,
    });
    app.set_transcript_viewport(
        inner.x,
        inner.y,
        inner.width,
        inner.height,
        area.right().saturating_sub(1),
    );
    let visible_lines = app
        .history
        .visible_lines(inner.height as usize, inner.width as usize);

    let transcript = Paragraph::new(visible_lines)
        .block(block)
        .wrap(Wrap { trim: false });
    frame.render_widget(transcript, area);

    let (position, total) = app
        .history
        .scrollbar_position(inner.height as usize, inner.width as usize);
    let mut state = ScrollbarState::new(total).position(position);
    let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
        .thumb_symbol("█")
        .track_symbol(Some("│"))
        .begin_symbol(None)
        .end_symbol(None)
        .style(Style::default().fg(Color::DarkGray));
    frame.render_stateful_widget(scrollbar, area, &mut state);
}

fn render_bottom_pane(frame: &mut Frame, area: Rect, app: &App) {
    let pane_bg = Color::Rgb(232, 232, 232);
    let block = Block::default()
        .style(Style::default().bg(pane_bg))
        .borders(Borders::TOP)
        .border_style(Style::default().fg(Color::Gray));
    frame.render_widget(Clear, area);
    frame.render_widget(block, area);

    let inner = area.inner(Margin {
        vertical: 1,
        horizontal: 2,
    });
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Length(3)])
        .split(inner);

    render_composer(frame, rows[0], app);
    render_footer(frame, rows[1], &app.status, &app.current_thread_id);
}

fn render_composer(frame: &mut Frame, area: Rect, app: &App) {
    let prompt = "> ";
    let available_width = area.width.saturating_sub(prompt.len() as u16) as usize;
    let visible_input = composer_visible_input(app.composer.input(), available_width);
    let input = Paragraph::new(Line::from(vec![
        Span::styled(
            prompt,
            Style::default()
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(visible_input.clone(), Style::default().fg(Color::Black)),
    ]))
    .style(Style::default().bg(Color::Rgb(232, 232, 232)))
    .wrap(Wrap { trim: false });
    frame.render_widget(input, area);

    let visible_width = UnicodeWidthStr::width(visible_input.as_str()) as u16;
    let max_x = area.right().saturating_sub(1);
    let cursor_x = (area.x + prompt.len() as u16 + visible_width).min(max_x);
    let cursor_y = area.y;
    frame.set_cursor_position((cursor_x, cursor_y));
}

fn composer_visible_input(input: &str, available_width: usize) -> String {
    if available_width == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(input) <= available_width {
        return input.to_string();
    }

    let mut result = String::new();
    let mut used = 0;
    for ch in input.chars().rev() {
        let ch_width = UnicodeWidthStr::width(ch.encode_utf8(&mut [0; 4]));
        if used + ch_width > available_width {
            break;
        }
        result.insert(0, ch);
        used += ch_width;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::composer_visible_input;

    #[test]
    fn keeps_tail_of_long_ascii_input_visible() {
        assert_eq!(composer_visible_input("abcdefghij", 5), "fghij");
    }

    #[test]
    fn keeps_tail_of_wide_input_visible() {
        assert_eq!(composer_visible_input("你好世界abc", 6), "界abc");
    }
}
