use crate::commands::active_page;
use crate::document::{Behavior, Document, Element, Page};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle { pub html: String, pub css: String, pub js: String }

pub fn preview(document: &Document) -> Result<ExportBundle, String> {
    let page = active_page(document)?;
    Ok(ExportBundle { html: emit_html(page), css: emit_css(&page.elements), js: emit_js(&page.elements) })
}

pub fn write_project(document: &Document, folder: &Path) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| format!("Could not create export folder: {error}"))?;
    fs::write(folder.join("styles.css"), project_css(document)).map_err(|error| format!("Could not write styles.css: {error}"))?;
    fs::write(folder.join("script.js"), project_js(document)).map_err(|error| format!("Could not write script.js: {error}"))?;
    for (index, page) in document.pages.iter().enumerate() {
        let filename = if index == 0 { "index.html".to_string() } else { format!("{}.html", safe_filename(&page.slug)) };
        fs::write(folder.join(filename), emit_html(page)).map_err(|error| format!("Could not write page {}: {error}", page.name))?;
    }
    Ok(())
}

fn project_css(document: &Document) -> String {
    let mut css = base_css();
    for page in &document.pages { emit_styles(&page.elements, &mut css); }
    css
}

fn project_js(document: &Document) -> String {
    let mut refs: Vec<&Element> = Vec::new();
    for page in &document.pages { refs.extend(page.elements.iter()); }
    emit_js_refs(&refs)
}

fn emit_html(page: &Page) -> String {
    let mut body = String::new();
    render_elements(&page.elements, 2, &mut body);
    format!("<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>{}</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n{}  <script src=\"script.js\" defer></script>\n</body>\n</html>\n", escape_html(&page.name), body)
}

fn render_elements(elements: &[Element], depth: usize, output: &mut String) {
    for element in elements {
        if element.hidden { continue; }
        let tag = tag_for(&element.kind);
        let indent = "  ".repeat(depth);
        let class_name = format!("vw-{}", element.id.replace('-', ""));
        let mut attrs = format!(" class=\"{}\" data-vw-id=\"{}\"", class_name, escape_html(&element.id));
        for (name, value) in &element.attributes {
            if !allowed_attribute(&element.kind, name) { continue; }
            attrs.push_str(&format!(" {}=\"{}\"", name, escape_html(value)));
        }
        if element.kind == "modal" { attrs.push_str(" role=\"dialog\""); }
        if matches!(tag, "img" | "input" | "hr") {
            output.push_str(&format!("{indent}<{tag}{attrs}>\n"));
            continue;
        }
        output.push_str(&format!("{indent}<{tag}{attrs}>"));
        if !element.content.is_empty() { output.push_str(&escape_html(&element.content)); }
        if element.children.is_empty() { output.push_str(&format!("</{tag}>\n")); }
        else {
            output.push('\n');
            render_elements(&element.children, depth + 1, output);
            output.push_str(&format!("{indent}</{tag}>\n"));
        }
    }
}

fn tag_for(kind: &str) -> &'static str {
    match kind {
        "section" => "section", "container" => "div", "heading" => "h2", "paragraph" => "p",
        "image" => "img", "button" | "link" => "a", "list" => "ul", "form" => "form",
        "input" => "input", "divider" => "hr", "spacer" => "div", "modal" => "dialog", "list_item" => "li", _ => "div",
    }
}

fn base_css() -> String {
    "* { box-sizing: border-box; }\nbody { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #18212f; }\n.is-hidden { display: none !important; }\n".into()
}

fn emit_css(elements: &[Element]) -> String {
    let mut css = base_css();
    emit_styles(elements, &mut css);
    css
}

fn emit_styles(elements: &[Element], output: &mut String) {
    for element in elements {
        let class_name = format!("vw-{}", element.id.replace('-', ""));
        if !element.styles.is_empty() {
            output.push_str(&format!(".{} {{\n", class_name));
            for (property, value) in &element.styles {
                output.push_str(&format!("  {}: {};\n", css_property(property), value.replace('{', "").replace('}', "")));
            }
            output.push_str("}\n");
        }
        emit_styles(&element.children, output);
    }
}

fn css_property(property: &str) -> String {
    let mut output = String::new();
    for character in property.chars() {
        if character.is_ascii_uppercase() { output.push('-'); output.push(character.to_ascii_lowercase()); }
        else { output.push(character); }
    }
    output
}

fn emit_js(elements: &[Element]) -> String {
    let refs: Vec<&Element> = elements.iter().collect();
    emit_js_refs(&refs)
}

fn emit_js_refs(elements: &[&Element]) -> String {
    let mut output = String::from("document.addEventListener('DOMContentLoaded', () => {\n");
    emit_js_tree(elements, &mut output);
    output.push_str("});\n");
    output
}

fn emit_js_tree(elements: &[&Element], output: &mut String) {
    for element in elements {
        emit_behaviors(&element.behaviors, &element.id, &mut output);
        let children: Vec<&Element> = element.children.iter().collect();
        emit_js_tree(&children, output);
    }
}

fn emit_behaviors(behaviors: &[Behavior], id: &str, output: &mut String) {
    for behavior in behaviors {
        let event = if behavior.trigger == "on_submit" { "submit" } else { "click" };
        let selector = format!("[data-vw-id=\\\"{}\\\"]", js_string(id));
        if behavior.trigger == "on_scroll" {
            output.push_str(&format!("  const observed_{} = document.querySelector('{}');\n  if (observed_{}) new IntersectionObserver((entries, observer) => {{ if (entries.some((entry) => entry.isIntersecting)) {{\n", js_identifier(id), selector, js_identifier(id)));
            emit_action(behavior, "    ", output);
            output.push_str(&format!("    observer.disconnect();\n  }} }}).observe(observed_{});\n", js_identifier(id)));
            continue;
        }
        output.push_str(&format!("  document.querySelector('{}')?.addEventListener('{}', (event) => {{\n", selector, event));
        emit_action(behavior, "    ", output);
        output.push_str("  });\n");
    }
}

fn emit_action(behavior: &Behavior, indent: &str, output: &mut String) {
        match behavior.action.as_str() {
            "open_url" => output.push_str(&format!("{indent}window.open('{}', '_blank', 'noopener,noreferrer');\n", js_string(&behavior.value))),
            "scroll_to" => output.push_str(&format!("{indent}document.querySelector('[data-vw-id=\\\"{}\\\"]')?.scrollIntoView({{ behavior: 'smooth' }});\n", js_string(&behavior.target))),
            "toggle" => output.push_str(&format!("{indent}document.querySelector('[data-vw-id=\\\"{}\\\"]')?.classList.toggle('is-hidden');\n", js_string(&behavior.target))),
            "open_modal" => output.push_str(&format!("{indent}document.querySelector('[data-vw-id=\\\"{}\\\"]')?.showModal?.();\n", js_string(&behavior.target))),
            "close_modal" => output.push_str(&format!("{indent}document.querySelector('[data-vw-id=\\\"{}\\\"]')?.close?.();\n", js_string(&behavior.target))),
            "validate_form" => output.push_str(&format!("{indent}if (event.target instanceof HTMLFormElement && !event.target.reportValidity()) event.preventDefault();\n")),
            "success_message" => output.push_str(&format!("{indent}event.preventDefault(); window.alert('{}');\n", js_string(&behavior.value))),
            "fade_in" => output.push_str(&format!("{indent}event.target.classList.add('is-visible');\n")),
            _ => {}
        }
}

fn js_identifier(value: &str) -> String { value.chars().map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' }).collect() }

fn allowed_attribute(kind: &str, name: &str) -> bool {
    match kind {
        "image" => matches!(name, "src" | "alt" | "title" | "loading"),
        "button" | "link" => matches!(name, "href" | "target" | "rel" | "title"),
        "input" => matches!(name, "type" | "placeholder" | "name" | "required" | "value" | "aria-label"),
        "form" => matches!(name, "action" | "method" | "name"),
        _ => matches!(name, "title" | "aria-label" | "role"),
    }
}

fn js_string(value: &str) -> String { value.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', " ") }
fn escape_html(value: &str) -> String { value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;") }
fn safe_filename(value: &str) -> String { value.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' }).collect() }
