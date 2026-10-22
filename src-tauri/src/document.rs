use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use uuid::Uuid;

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub schema_version: u32,
    pub name: String,
    pub pages: Vec<Page>,
    pub active_page_id: String,
    pub settings: EditorSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub elements: Vec<Element>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub attributes: BTreeMap<String, String>,
    #[serde(default)]
    pub styles: BTreeMap<String, String>,
    #[serde(default)]
    pub behaviors: Vec<Behavior>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub children: Vec<Element>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Behavior {
    pub trigger: String,
    pub action: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    pub layout: String,
}

impl Default for Document {
    fn default() -> Self {
        let page_id = new_id();
        Self {
            schema_version: 1,
            name: "Untitled website".into(),
            pages: vec![Page {
                id: page_id.clone(),
                name: "Home".into(),
                slug: "index".into(),
                elements: Vec::new(),
            }],
            active_page_id: page_id,
            settings: EditorSettings { layout: "modern".into() },
        }
    }
}

impl Element {
    pub fn new(kind: &str) -> Self {
        let (name, content) = match kind {
            "section" => ("Section", String::new()),
            "container" => ("Container", String::new()),
            "heading" => ("Heading", "Your heading".into()),
            "paragraph" => ("Paragraph", "Add your text here. Click to edit this paragraph.".into()),
            "image" => ("Image", String::new()),
            "button" => ("Button", "Button".into()),
            "link" => ("Link", "Link text".into()),
            "list" => ("List", String::new()),
            "list_item" => ("List item", "List item".into()),
            "form" => ("Form", String::new()),
            "input" => ("Input", String::new()),
            "divider" => ("Divider", String::new()),
            "spacer" => ("Spacer", String::new()),
            "modal" => ("Modal", "Modal content".into()),
            _ => ("Element", String::new()),
        };
        let mut attributes = BTreeMap::new();
        if kind == "image" {
            attributes.insert("src".into(), "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80".into());
            attributes.insert("alt".into(), "Workspace".into());
        } else if kind == "button" || kind == "link" {
            attributes.insert("href".into(), "#".into());
        } else if kind == "input" {
            attributes.insert("placeholder".into(), "Enter text".into());
            attributes.insert("type".into(), "text".into());
        }
        let mut styles = BTreeMap::new();
        match kind {
            "section" => { styles.insert("padding".into(), "48px 32px".into()); styles.insert("backgroundColor".into(), "#ffffff".into()); }
            "container" => { styles.insert("maxWidth".into(), "1100px".into()); styles.insert("margin".into(), "0 auto".into()); }
            "heading" => { styles.insert("fontSize".into(), "36px".into()); styles.insert("fontWeight".into(), "700".into()); styles.insert("color".into(), "#18212f".into()); }
            "paragraph" => { styles.insert("fontSize".into(), "16px".into()); styles.insert("lineHeight".into(), "1.6".into()); styles.insert("color".into(), "#596579".into()); }
            "button" => { styles.insert("backgroundColor".into(), "#5969f6".into()); styles.insert("color".into(), "#ffffff".into()); styles.insert("padding".into(), "12px 18px".into()); styles.insert("borderRadius".into(), "8px".into()); styles.insert("display".into(), "inline-block".into()); styles.insert("textDecoration".into(), "none".into()); }
            "image" => { styles.insert("maxWidth".into(), "100%".into()); styles.insert("borderRadius".into(), "12px".into()); }
            "divider" => { styles.insert("border".into(), "0".into()); styles.insert("borderTop".into(), "1px solid #e5e8ef".into()); styles.insert("margin".into(), "24px 0".into()); }
            "spacer" => { styles.insert("height".into(), "40px".into()); }
            "modal" => { styles.insert("padding".into(), "28px".into()); styles.insert("border".into(), "1px solid #e5e8ef".into()); styles.insert("borderRadius".into(), "14px".into()); styles.insert("backgroundColor".into(), "#ffffff".into()); styles.insert("boxShadow".into(), "0 16px 50px rgba(22, 30, 48, .18)".into()); }
            _ => {}
        }
        Self { id: new_id(), kind: kind.into(), name: name.into(), content, attributes, styles, behaviors: Vec::new(), hidden: false, children: Vec::new() }
    }
}
