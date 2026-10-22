use crate::document::{new_id, Behavior, Document, Element, Page};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum EditIntent {
    AddElement { kind: String, #[serde(default)] parent_id: Option<String>, #[serde(default)] index: Option<usize> },
    UpdateContent { id: String, content: String },
    SetStyle { id: String, property: String, value: String },
    SetAttribute { id: String, name: String, value: String },
    RenameElement { id: String, name: String },
    SetHidden { id: String, hidden: bool },
    SetBehaviors { id: String, behaviors: Vec<Behavior> },
    MoveElement { id: String, #[serde(default)] parent_id: Option<String>, index: usize },
    DuplicateElement { id: String },
    PasteElement { element: Element, #[serde(default)] parent_id: Option<String>, #[serde(default)] index: Option<usize> },
    DeleteElement { id: String },
    AddPage { name: String },
    RenamePage { id: String, name: String },
    DeletePage { id: String },
    SetActivePage { id: String },
    SetLayout { layout: String },
    RenameProject { name: String },
}

pub fn apply(document: &mut Document, intent: EditIntent) -> Result<(), String> {
    match intent {
        EditIntent::AddElement { kind, parent_id, index } => {
            let mut element = Element::new(&kind);
            if kind == "list" { element.children = vec![Element::new("list_item"), Element::new("list_item")]; }
            let page = active_page_mut(document)?;
            insert_element(&mut page.elements, parent_id.as_deref(), index.unwrap_or(usize::MAX), element)?;
        }
        EditIntent::UpdateContent { id, content } => update_element(document, &id, |element| element.content = content)?,
        EditIntent::SetStyle { id, property, value } => update_element(document, &id, |element| {
            if value.is_empty() { element.styles.remove(&property); } else { element.styles.insert(property, value); }
        })?,
        EditIntent::SetAttribute { id, name, value } => update_element(document, &id, |element| {
            if value.is_empty() { element.attributes.remove(&name); } else { element.attributes.insert(name, value); }
        })?,
        EditIntent::RenameElement { id, name } => update_element(document, &id, |element| element.name = name)?,
        EditIntent::SetHidden { id, hidden } => update_element(document, &id, |element| element.hidden = hidden)?,
        EditIntent::SetBehaviors { id, behaviors } => update_element(document, &id, |element| element.behaviors = behaviors)?,
        EditIntent::MoveElement { id, parent_id, index } => {
            let page = active_page_mut(document)?;
            if parent_id.as_deref() == Some(id.as_str()) || parent_id.as_deref().is_some_and(|p| is_descendant(&page.elements, &id, p)) {
                return Err("An element cannot be moved inside itself.".into());
            }
            if parent_id.as_deref().is_some_and(|parent| find_element(&page.elements, parent).is_none()) {
                return Err("Drop target not found.".into());
            }
            let element = remove_element(&mut page.elements, &id).ok_or_else(|| "Element not found.".to_string())?;
            insert_element(&mut page.elements, parent_id.as_deref(), index, element)?;
        }
        EditIntent::DuplicateElement { id } => {
            let page = active_page_mut(document)?;
            let mut clone = find_element(&page.elements, &id).ok_or_else(|| "Element not found.".to_string())?.clone();
            refresh_ids(&mut clone);
            let parent = find_parent_id(&page.elements, &id);
            insert_element(&mut page.elements, parent.as_deref(), usize::MAX, clone)?;
        }
        EditIntent::PasteElement { mut element, parent_id, index } => {
            let page = active_page_mut(document)?;
            refresh_ids(&mut element);
            insert_element(&mut page.elements, parent_id.as_deref(), index.unwrap_or(usize::MAX), element)?;
        }
        EditIntent::DeleteElement { id } => {
            let page = active_page_mut(document)?;
            if remove_element(&mut page.elements, &id).is_none() { return Err("Element not found.".into()); }
        }
        EditIntent::AddPage { name } => {
            let id = new_id();
            let slug = slugify(&name);
            document.pages.push(Page { id: id.clone(), name, slug, elements: Vec::new() });
            document.active_page_id = id;
        }
        EditIntent::RenamePage { id, name } => {
            let page = document.pages.iter_mut().find(|page| page.id == id).ok_or_else(|| "Page not found.".to_string())?;
            page.name = name.clone();
            page.slug = slugify(&name);
        }
        EditIntent::DeletePage { id } => {
            if document.pages.len() <= 1 { return Err("A project must keep at least one page.".into()); }
            let position = document.pages.iter().position(|page| page.id == id).ok_or_else(|| "Page not found.".to_string())?;
            document.pages.remove(position);
            if document.active_page_id == id { document.active_page_id = document.pages[0].id.clone(); }
        }
        EditIntent::SetActivePage { id } => {
            if !document.pages.iter().any(|page| page.id == id) { return Err("Page not found.".into()); }
            document.active_page_id = id;
        }
        EditIntent::SetLayout { layout } => {
            if layout != "classic" && layout != "modern" { return Err("Unknown editor layout.".into()); }
            document.settings.layout = layout;
        }
        EditIntent::RenameProject { name } => document.name = name,
    }
    Ok(())
}

pub fn active_page(document: &Document) -> Result<&Page, String> {
    document.pages.iter().find(|page| page.id == document.active_page_id).ok_or_else(|| "Active page not found.".into())
}

fn active_page_mut(document: &mut Document) -> Result<&mut Page, String> {
    document.pages.iter_mut().find(|page| page.id == document.active_page_id).ok_or_else(|| "Active page not found.".into())
}

fn update_element(document: &mut Document, id: &str, update: impl FnOnce(&mut Element)) -> Result<(), String> {
    let page = active_page_mut(document)?;
    let element = find_element_mut(&mut page.elements, id).ok_or_else(|| "Element not found.".to_string())?;
    update(element);
    Ok(())
}

pub fn find_element(elements: &[Element], id: &str) -> Option<&Element> {
    for element in elements {
        if element.id == id { return Some(element); }
        if let Some(found) = find_element(&element.children, id) { return Some(found); }
    }
    None
}

fn find_element_mut(elements: &mut [Element], id: &str) -> Option<&mut Element> {
    for element in elements {
        if element.id == id { return Some(element); }
        if let Some(found) = find_element_mut(&mut element.children, id) { return Some(found); }
    }
    None
}

fn find_parent_id(elements: &[Element], id: &str) -> Option<String> {
    for element in elements {
        if element.children.iter().any(|child| child.id == id) { return Some(element.id.clone()); }
        if let Some(found) = find_parent_id(&element.children, id) { return Some(found); }
    }
    None
}

fn is_descendant(elements: &[Element], ancestor: &str, candidate: &str) -> bool {
    find_element(elements, ancestor).is_some_and(|element| find_element(&element.children, candidate).is_some())
}

fn remove_element(elements: &mut Vec<Element>, id: &str) -> Option<Element> {
    if let Some(position) = elements.iter().position(|element| element.id == id) { return Some(elements.remove(position)); }
    for element in elements {
        if let Some(found) = remove_element(&mut element.children, id) { return Some(found); }
    }
    None
}

fn insert_element(elements: &mut Vec<Element>, parent_id: Option<&str>, index: usize, element: Element) -> Result<(), String> {
    if let Some(parent_id) = parent_id {
        let parent = find_element_mut(elements, parent_id).ok_or_else(|| "Drop target not found.".to_string())?;
        let target = index.min(parent.children.len());
        parent.children.insert(target, element);
    } else {
        let target = index.min(elements.len());
        elements.insert(target, element);
    }
    Ok(())
}

fn refresh_ids(element: &mut Element) {
    element.id = new_id();
    for child in &mut element.children { refresh_ids(child); }
}

fn slugify(value: &str) -> String {
    let slug = value.to_lowercase().chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' }).collect::<String>();
    let compact = slug.split('-').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("-");
    if compact.is_empty() { "page".into() } else { compact }
}
