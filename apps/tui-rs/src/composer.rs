use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FooterMode {
    Empty,
    HasDraft,
    ShortcutOverlay,
    EscHint,
}

pub enum ComposerAction {
    None,
    Redraw,
    Submit(String),
    Quit,
}

pub struct Composer {
    input: String,
    footer_mode: FooterMode,
}

impl Composer {
    pub fn new() -> Self {
        Self {
            input: String::new(),
            footer_mode: FooterMode::Empty,
        }
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> ComposerAction {
        match key.code {
            KeyCode::Enter => {
                let text = self.input.clone();
                ComposerAction::Submit(text)
            }
            KeyCode::Backspace => {
                self.input.pop();
                self.sync_footer_mode();
                ComposerAction::Redraw
            }
            KeyCode::Esc => {
                if self.footer_mode == FooterMode::ShortcutOverlay {
                    self.footer_mode = if self.input.is_empty() {
                        FooterMode::Empty
                    } else {
                        FooterMode::HasDraft
                    };
                } else if self.input.is_empty() {
                    self.footer_mode = FooterMode::EscHint;
                } else {
                    self.input.clear();
                    self.footer_mode = FooterMode::EscHint;
                }
                ComposerAction::Redraw
            }
            KeyCode::Char('?') if self.input.is_empty() => {
                self.footer_mode = if self.footer_mode == FooterMode::ShortcutOverlay {
                    FooterMode::Empty
                } else {
                    FooterMode::ShortcutOverlay
                };
                ComposerAction::Redraw
            }
            KeyCode::Char('d') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                ComposerAction::Quit
            }
            KeyCode::Char(ch) => {
                self.input.push(ch);
                self.sync_footer_mode();
                ComposerAction::Redraw
            }
            _ => ComposerAction::None,
        }
    }

    pub fn clear(&mut self) {
        self.input.clear();
        self.sync_footer_mode();
    }

    pub fn insert_text(&mut self, text: &str) {
        self.input.push_str(text);
        self.sync_footer_mode();
    }

    pub fn input(&self) -> &str {
        &self.input
    }

    pub fn footer_mode(&self) -> FooterMode {
        self.footer_mode
    }

    pub fn is_empty(&self) -> bool {
        self.input.is_empty()
    }

    fn sync_footer_mode(&mut self) {
        self.footer_mode = if self.input.is_empty() {
            FooterMode::Empty
        } else {
            FooterMode::HasDraft
        };
    }
}

#[cfg(test)]
mod tests {
    use super::{Composer, ComposerAction, FooterMode};
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    #[test]
    fn toggles_shortcut_overlay_when_question_mark_pressed_on_empty_input() {
        let mut composer = Composer::new();
        let action = composer.handle_key(KeyEvent::new(KeyCode::Char('?'), KeyModifiers::NONE));
        assert!(matches!(action, ComposerAction::Redraw));
        assert_eq!(composer.footer_mode(), FooterMode::ShortcutOverlay);
    }

    #[test]
    fn submits_current_text_on_enter() {
        let mut composer = Composer::new();
        composer.insert_text("ship it");
        let action = composer.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        match action {
            ComposerAction::Submit(text) => assert_eq!(text, "ship it"),
            _ => panic!("expected submit action"),
        }
    }
}
