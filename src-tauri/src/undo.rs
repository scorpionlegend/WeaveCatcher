use crate::document::Document;

#[derive(Default)]
pub struct History {
    undo: Vec<Document>,
    redo: Vec<Document>,
}

impl History {
    pub fn record(&mut self, before: Document) {
        self.undo.push(before);
        if self.undo.len() > 100 { self.undo.remove(0); }
        self.redo.clear();
    }

    pub fn undo(&mut self, current: Document) -> Option<Document> {
        let previous = self.undo.pop()?;
        self.redo.push(current);
        Some(previous)
    }

    pub fn redo(&mut self, current: Document) -> Option<Document> {
        let next = self.redo.pop()?;
        self.undo.push(current);
        Some(next)
    }
}
