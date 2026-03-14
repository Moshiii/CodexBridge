mod app;
mod bridge;
mod composer;
mod footer;
mod history;
mod ui;

use std::io::{self, Stdout};
use std::time::Duration;

use anyhow::Result;
use crossterm::event;
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;

use crate::app::App;
use crate::bridge::BridgeHandle;

fn main() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let result = run_app(&mut terminal);
    restore_terminal(terminal)?;
    result
}

fn run_app(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    let bridge = BridgeHandle::spawn()?;
    let mut app = App::new(bridge);
    app.initialize()?;

    while !app.should_quit {
        app.drain_bridge_events();
        ui::draw(terminal, &mut app)?;

        if event::poll(Duration::from_millis(50))? {
            let next = event::read()?;
            app.handle_event(next)?;
        }
    }

    app.shutdown()?;

    Ok(())
}

fn restore_terminal(mut terminal: Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;
    Ok(())
}
