use crate::commands::active_page;
use crate::document::{Behavior, Document, Element, Page};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::{fs, path::{Path, PathBuf}};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportBundle { pub html: String, pub css: String, pub js: String }

pub fn preview(document: &Document) -> Result<ExportBundle, String> {
    let page = active_page(document)?;
    let mut paths = Vec::new();
    collect_media_paths(&page.elements, &mut paths);
    let media: HashMap<String, String> = paths.into_iter().map(|path| (path.clone(), asset_url(&path))).collect();
    Ok(ExportBundle {
        html: page_code(page, &media),
        css: sheet_code(document, page),
        js: script_code(document),
    })
}

/// The HTML written for a page: hand-edited code when the page has any, generated otherwise.
fn page_code(page: &Page, media: &HashMap<String, String>) -> String {
    if page.custom_html.is_empty() { emit_html(page, media) } else { page.custom_html.clone() }
}

/// The stylesheet shown in a single-page preview, falling back to the styles generated for that page.
fn sheet_code(document: &Document, page: &Page) -> String {
    if document.custom_css.is_empty() { emit_css(&page.elements) } else { document.custom_css.clone() }
}

/// The stylesheet written to the export folder, falling back to the styles of every page.
fn export_sheet_code(document: &Document) -> String {
    if document.custom_css.is_empty() { project_css(document) } else { document.custom_css.clone() }
}

/// The script written for the project, falling back to the preview script for the active page.
fn script_code(document: &Document) -> String {
    if document.custom_js.is_empty() { project_js(document) } else { document.custom_js.clone() }
}

pub fn write_project(document: &Document, folder: &Path) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| format!("Could not create export folder: {error}"))?;
    let media = copy_local_media(document, folder)?;
    fs::write(folder.join("styles.css"), export_sheet_code(document)).map_err(|error| format!("Could not write styles.css: {error}"))?;
    fs::write(folder.join("script.js"), script_code(document)).map_err(|error| format!("Could not write script.js: {error}"))?;
    for (index, page) in document.pages.iter().enumerate() {
        let filename = if index == 0 { "index.html".to_string() } else { format!("{}.html", safe_filename(&page.slug)) };
        fs::write(folder.join(filename), page_code(page, &media)).map_err(|error| format!("Could not write page {}: {error}", page.name))?;
    }
    Ok(())
}

/// Copies every locally-referenced media file into <folder>/media and maps the
/// original path to its exported relative URL.
fn copy_local_media(document: &Document, folder: &Path) -> Result<HashMap<String, String>, String> {
    let mut paths = Vec::new();
    for page in &document.pages { collect_media_paths(&page.elements, &mut paths); }
    let mut media: HashMap<String, String> = HashMap::new();
    let mut used: HashSet<String> = HashSet::new();
    for path in paths {
        if media.contains_key(&path) { continue; }
        let source = PathBuf::from(&path);
        if !source.is_file() { continue; }
        let original = source.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "file".to_string());
        let mut candidate = original.clone();
        let mut counter = 1;
        while used.contains(&candidate.to_lowercase()) {
            counter += 1;
            let dot = original.rfind('.').unwrap_or(original.len());
            candidate = format!("{}-{}.{}", &original[..dot], counter, &original[dot + 1..]);
        }
        used.insert(candidate.to_lowercase());
        let media_dir = folder.join("media");
        fs::create_dir_all(&media_dir).map_err(|error| format!("Could not create the media folder: {error}"))?;
        fs::copy(&source, media_dir.join(&candidate)).map_err(|error| format!("Could not copy {path}: {error}"))?;
        media.insert(path, format!("media/{}", candidate));
    }
    Ok(media)
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

fn emit_html(page: &Page, media: &HashMap<String, String>) -> String {
    let mut body = String::new();
    render_elements(&page.elements, 2, &mut body, media);
    format!("<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>{}</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n{}  <script src=\"script.js\" defer></script>\n</body>\n</html>\n", escape_html(&page.name), body)
}

/// Media attributes on media elements may hold local file paths (chosen with the
/// file browser); remote/data URLs are left untouched.
fn is_media_attribute(kind: &str, name: &str) -> bool {
    matches!(kind, "image" | "rollover" | "video" | "audio" | "strip") && matches!(name, "src" | "poster" | "data-rollover")
}

fn is_remote_media(value: &str) -> bool {
    value.is_empty() || value.starts_with("http://") || value.starts_with("https://") || value.starts_with("data:") || value.starts_with("blob:") || value.starts_with("asset:")
}

fn collect_media_paths(elements: &[Element], paths: &mut Vec<String>) {
    for element in elements {
        for (name, value) in &element.attributes {
            if is_media_attribute(&element.kind, name) && !is_remote_media(value) { paths.push(value.clone()); }
        }
        collect_media_paths(&element.children, paths);
    }
}

fn encode_uri_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')') { out.push(*byte as char); }
        else { out.push_str(&format!("%{:02X}", byte)); }
    }
    out
}

/// Same URL shape the webview's convertFileSrc produces, so preview HTML shows local media.
fn asset_url(path: &str) -> String {
    if cfg!(windows) { format!("http://asset.localhost/{}", encode_uri_component(path)) } else { format!("asset://localhost/{}", encode_uri_component(path)) }
}

fn render_elements(elements: &[Element], depth: usize, output: &mut String, media: &HashMap<String, String>) {
    for element in elements {
        if element.hidden { continue; }
        let tag = tag_for(&element.kind);
        let indent = "  ".repeat(depth);
        let class_name = export_class(element);
        let mut attrs = format!(" class=\"{}\" data-vw-id=\"{}\"", class_name, escape_html(&element.id));
        for (name, value) in &element.attributes {
            if !allowed_attribute(&element.kind, name) { continue; }
            let value = if is_media_attribute(&element.kind, name) && !is_remote_media(value) { media.get(value).cloned().unwrap_or_else(|| value.clone()) } else { value.clone() };
            attrs.push_str(&format!(" {}=\"{}\"", name, escape_html(&value)));
        }
        if element.kind == "modal" { attrs.push_str(" role=\"dialog\""); }
        let required = element.attributes.contains_key("required");
        if element.kind == "input" && (required || !element.content.is_empty()) {
            let mut field_attrs = String::new();
            for (name, value) in &element.attributes {
                if !allowed_attribute("input", name) { continue; }
                field_attrs.push_str(&format!(" {}=\"{}\"", name, escape_html(value)));
            }
            let star = if required { " <span class=\"vw-required\">*</span>" } else { "" };
            output.push_str(&format!("{indent}<label{attrs}><input{field_attrs}> {text}{star}</label>\n", field_attrs = field_attrs, text = escape_html(&element.content), star = star));
            continue;
        }
        if matches!(element.kind.as_str(), "checkbox" | "radio") {
            let kind = element.kind.as_str();
            let field_name = element.attributes.get("name").map(String::as_str).unwrap_or("option");
            let checked = if element.attributes.contains_key("checked") { " checked" } else { "" };
            let required_attr = if required { " required" } else { "" };
            let star = if required { "<span class=\"vw-required\">*</span>" } else { "" };
            output.push_str(&format!("{indent}<label{attrs}><input type=\"{kind}\" name=\"{name}\"{checked}{required_attr}> {text}{star}</label>\n", name = escape_html(field_name), text = escape_html(&element.content), star = star));
            continue;
        }
        if element.kind == "textbox" {
            let mut field_attrs = String::new();
            for (name, value) in &element.attributes {
                if !allowed_attribute("textbox", name) { continue; }
                field_attrs.push_str(&format!(" {}=\"{}\"", name, escape_html(value)));
            }
            let star = if required { " <span class=\"vw-required\">*</span>" } else { "" };
            output.push_str(&format!("{indent}<label{attrs}><textarea{field_attrs}></textarea> {text}{star}</label>\n", field_attrs = field_attrs, text = escape_html(&element.content), star = star));
            continue;
        }
        if element.kind == "dropdown" {
            let select_attrs = format!(" name=\"{}\"{}", escape_html(element.attributes.get("name").map(String::as_str).unwrap_or("choice")), if required { " required" } else { "" });
            let star = if required { " <span class=\"vw-required\">*</span>" } else { "" };
            output.push_str(&format!("{indent}<label{attrs}><select{select_attrs}>"));
            for option in element.attributes.get("options").map(String::as_str).unwrap_or("").split('\n').filter(|option| !option.trim().is_empty()) {
                output.push_str(&format!("<option>{}</option>", escape_html(option.trim())));
            }
            let text = if element.content.is_empty() { String::new() } else { format!(" {}", escape_html(&element.content)) };
            output.push_str(&format!("</select>{text}{star}</label>\n", text = text, star = star));
            continue;
        }
        if element.kind == "datetime" {
            let field_name = element.attributes.get("name").map(String::as_str).unwrap_or("appt");
            let req = if required { " required" } else { "" };
            let label = if element.content.is_empty() { String::new() } else { format!("<span class=\"vw-dt-label\">{}</span>", escape_html(&element.content)) };
            output.push_str(&format!("{indent}<div{attrs}>{label}<label>Date <input type=\"date\" name=\"{}-date\"{req}></label> <label>Time <input type=\"time\" name=\"{}-time\"{req}></label></div>\n", escape_html(field_name), escape_html(field_name)));
            continue;
        }
        if element.kind == "table" {
            let rows: usize = element.attributes.get("rows").and_then(|value| value.parse().ok()).unwrap_or(3).clamp(1, 30);
            let cols: usize = element.attributes.get("cols").and_then(|value| value.parse().ok()).unwrap_or(3).clamp(1, 10);
            let header = element.attributes.get("header").map(|value| value == "on").unwrap_or(false);
            let cells = table_cells(element, rows, cols);
            output.push_str(&format!("{indent}<table{attrs}>\n"));
            let mut body_rows = cells.as_slice();
            if header {
                output.push_str(&format!("{indent}  <thead>\n{indent}    <tr>"));
                for value in &cells[0] { output.push_str(&format!("<th>{}</th>", escape_html(value))); }
                output.push_str(&format!("</tr>\n{indent}  </thead>\n"));
                body_rows = &cells[1..];
            }
            output.push_str(&format!("{indent}  <tbody>\n"));
            for row in body_rows {
                output.push_str(&format!("{indent}    <tr>"));
                for value in row { output.push_str(&format!("<td>{}</td>", escape_html(value))); }
                output.push_str("</tr>\n");
            }
            output.push_str(&format!("{indent}  </tbody>\n{indent}</table>\n"));
            continue;
        }
        if element.kind == "strip" {
            let src = element.attributes.get("src").map(String::as_str).unwrap_or("");
            let image = if src.is_empty() { String::new() } else if is_remote_media(src) { src.to_string() } else { media.get(src).cloned().unwrap_or_else(|| src.to_string()) };
            let style = if image.is_empty() { String::new() } else { format!(" style=\"background-image:url('{}'); background-size:cover; background-position:center;\"", escape_html(&image)) };
            let strip_attrs = attrs.replacen("class=\"", "class=\"vw-strip ", 1);
            output.push_str(&format!("{indent}<div{strip_attrs}{style}>"));
            if !element.content.is_empty() { output.push_str(&format!("<span class=\"vw-strip-text\">{}</span>", escape_html(&element.content))); }
            output.push_str("</div>\n");
            continue;
        }
        if element.kind == "calendar" {
            // Shell only — the visitor's browser fills the weekday row and day grid with
            // the current month (see emit_calendar).
            let subtitle = element.attributes.get("subtitle").map(String::as_str).unwrap_or("");
            output.push_str(&format!("{indent}<div{attrs}>\n"));
            output.push_str(&format!("{indent}  <div class=\"vw-cal-strip\">\n"));
            output.push_str(&format!("{indent}    <p class=\"vw-cal-month\" data-cal-month></p>\n"));
            output.push_str(&format!("{indent}    <h3 class=\"vw-cal-title\">{}</h3>\n", escape_html(&element.content)));
            if !subtitle.is_empty() { output.push_str(&format!("{indent}    <p class=\"vw-cal-sub\">{}</p>\n", escape_html(subtitle))); }
            output.push_str(&format!("{indent}  </div>\n"));
            output.push_str(&format!("{indent}  <div class=\"vw-cal-week\" data-cal-week></div>\n"));
            output.push_str(&format!("{indent}  <div class=\"vw-cal-days\" data-cal-days></div>\n"));
            output.push_str(&format!("{indent}</div>\n"));
            continue;
        }
        if matches!(tag, "img" | "input" | "hr") {
            output.push_str(&format!("{indent}<{tag}{attrs}>\n"));
            continue;
        }
        output.push_str(&format!("{indent}<{tag}{attrs}>"));
        if !element.content.is_empty() { output.push_str(&escape_html(&element.content)); }
        if element.children.is_empty() { output.push_str(&format!("</{tag}>\n")); }
        else {
            output.push('\n');
            render_elements(&element.children, depth + 1, output, media);
            output.push_str(&format!("{indent}</{tag}>\n"));
        }
    }
}

fn tag_for(kind: &str) -> &'static str {
    match kind {
        "section" => "section", "container" => "div", "heading" => "h2", "paragraph" => "p",
        "image" | "rollover" => "img", "gallery" => "div", "iframe" => "iframe", "video" => "video", "audio" => "audio", "button" | "link" => "a", "list" | "ul" => "ul", "ol" => "ol", "form" => "form",
        "input" => "input", "divider" => "hr", "spacer" => "div", "modal" => "dialog", "list_item" => "li", "checkbox" | "radio" => "label",
        "navbar" => "nav", "footer" => "footer", "grid" => "div", _ => "div",
    }
}

fn base_css() -> String {
    "* { box-sizing: border-box; }\nbody { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #18212f; }\n.is-hidden { display: none !important; }\n.vw-required { color: #d0453e; font-weight: 600; }\n.vw-cal-strip { background: var(--vw-calendar-strip, #5f65e8); padding: 18px 20px; border-radius: 9px 9px 0 0; color: #ffffff; }\n.vw-cal-month { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; opacity: .8; }\n.vw-cal-title { margin: 4px 0 0; font-size: 20px; }\n.vw-cal-sub { margin: 6px 0 0; font-size: 13px; opacity: .85; }\n.vw-cal-week, .vw-cal-days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }\n.vw-cal-week { margin-top: 16px; }\n.vw-cal-cell { padding: 8px 0; text-align: center; font-size: 13px; border-radius: 6px; color: #333d4d; }\n.vw-cal-cell.pad { visibility: hidden; }\n.vw-cal-cell.event { background: #eef0ff; font-weight: 700; color: #3f48c9; cursor: pointer; }\n.vw-cal-cell.today { box-shadow: inset 0 0 0 2px #5f65e8; }\n.vw-datetime { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }\n.vw-dt-label { font-weight: 600; }\n.vw-datetime label { display: inline-flex; align-items: center; gap: 6px; }\ntable { border-collapse: collapse; }\nth, td { border: 1px solid #dfe3ec; padding: 8px 12px; text-align: left; }\nth { background: #f5f6fb; }\n.vw-strip { display: flex; align-items: center; justify-content: center; overflow: hidden; }\n.vw-strip-text { color: #ffffff; font-size: 26px; font-weight: 700; text-shadow: 0 1px 8px rgba(16, 20, 37, .45); }\n".into()
}

fn emit_css(elements: &[Element]) -> String {
    let mut css = base_css();
    emit_styles(elements, &mut css);
    css
}

fn emit_styles(elements: &[Element], output: &mut String) {
    for element in elements {
        let class_name = export_class(element);
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

fn emit_js_refs(elements: &[&Element]) -> String {
    let mut output = String::from("document.addEventListener('DOMContentLoaded', () => {\n");
    emit_js_tree(elements, &mut output);
    output.push_str("});\n");
    output
}

fn emit_js_tree(elements: &[&Element], output: &mut String) {
    for element in elements {
        emit_behaviors(&element.behaviors, &element.id, output);
        if element.kind == "rollover" { emit_rollover(element, output); }
        if element.kind == "form" { emit_form_validation(element, output); }
        if element.kind == "calendar" { emit_calendar(element, output); }
        let children: Vec<&Element> = element.children.iter().collect();
        emit_js_tree(&children, output);
    }
}

/// Blocks submission while a required field inside the form is empty. Buttons are
/// anchors in exported sites, so a click listener is needed for them to trigger
/// validation at all; the submit listener covers real submit buttons.
fn emit_form_validation(element: &Element, output: &mut String) {
    let selector = format!("[data-vw-id=\\\"{}\\\"]", js_string(&element.id));
    let ident = js_identifier(&element.id);
    output.push_str(&format!("  const form_{ident} = document.querySelector('{selector}');\n"));
    output.push_str(&format!("  if (form_{ident}) {{\n"));
    output.push_str(&format!("    form_{ident}.addEventListener('submit', (event) => {{ if (!form_{ident}.checkValidity()) {{ event.preventDefault(); form_{ident}.reportValidity(); }} }});\n"));
    output.push_str(&format!("    form_{ident}.addEventListener('click', (event) => {{\n"));
    output.push_str(&format!("      const trigger = event.target.closest('a, button');\n"));
    output.push_str(&format!("      if (trigger && !form_{ident}.checkValidity()) {{ event.preventDefault(); form_{ident}.reportValidity(); }}\n"));
    output.push_str("    });\n");
    output.push_str("  }\n");
}

#[derive(serde::Deserialize)]
struct CalendarEvent { date: String, #[serde(default)] title: String }

fn calendar_events(element: &Element) -> Vec<CalendarEvent> {
    serde_json::from_str(element.attributes.get("events").map(String::as_str).unwrap_or("[]")).unwrap_or_default()
}

/// The table's cell texts, resized to exactly rows×cols (missing cells empty, extras dropped,
/// malformed JSON → an all-empty grid so a broken attribute can't take the table down).
fn table_cells(element: &Element, rows: usize, cols: usize) -> Vec<Vec<String>> {
    let stored: Vec<Vec<String>> = serde_json::from_str(element.attributes.get("cells").map(String::as_str).unwrap_or("[]")).unwrap_or_default();
    (0..rows).map(|row| (0..cols).map(|col| stored.get(row).and_then(|values| values.get(col)).cloned().unwrap_or_default()).collect()).collect()
}

/// Fills the calendar shell in the visitor's browser with the current month — weekday
/// row, day grid, today's outline and the days carrying events — so the calendar is
/// always up to date without regenerating the site.
fn emit_calendar(element: &Element, output: &mut String) {
    let ident = js_identifier(&element.id);
    let selector = format!("[data-vw-id=\\\"{}\\\"]", js_string(&element.id));
    let events = calendar_events(element).iter()
        .map(|event| format!("'{}':'{}'", js_string(&event.date), js_string(&event.title)))
        .collect::<Vec<_>>().join(",");
    let monday = element.attributes.get("weekStart").map(|value| value == "monday").unwrap_or(false);
    output.push_str(&format!("  const cal_{ident} = document.querySelector('{selector}');\n"));
    output.push_str(&format!("  if (cal_{ident}) {{\n"));
    output.push_str(&format!("    const cal_days_{ident} = cal_{ident}.querySelector('[data-cal-days]');\n"));
    output.push_str(&format!("    const cal_week_{ident} = cal_{ident}.querySelector('[data-cal-week]');\n"));
    output.push_str(&format!("    const cal_month_{ident} = cal_{ident}.querySelector('[data-cal-month]');\n"));
    output.push_str(&format!("    const cal_events_{ident} = {{{events}}};\n"));
    output.push_str(&format!("    const cal_names_{ident} = ['January','February','March','April','May','June','July','August','September','October','November','December'];\n"));
    output.push_str(&format!("    const cal_dow_{ident} = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];\n"));
    output.push_str(&format!("    const cal_now_{ident} = new Date();\n"));
    output.push_str(&format!("    const cal_y_{ident} = cal_now_{ident}.getFullYear(), cal_m_{ident} = cal_now_{ident}.getMonth();\n"));
    output.push_str(&format!("    const cal_mon_{ident} = {monday};\n"));
    output.push_str(&format!("    if (cal_month_{ident}) cal_month_{ident}.textContent = cal_names_{ident}[cal_m_{ident}] + ' ' + cal_y_{ident};\n"));
    output.push_str(&format!("    if (cal_week_{ident}) (cal_mon_{ident} ? [1,2,3,4,5,6,0] : [0,1,2,3,4,5,6]).forEach((d) => {{ const c = document.createElement('div'); c.className = 'vw-cal-cell'; c.textContent = cal_dow_{ident}[d]; cal_week_{ident}.appendChild(c); }});\n"));
    output.push_str(&format!("    const cal_pad_{ident} = (new Date(cal_y_{ident}, cal_m_{ident}, 1).getDay() + (cal_mon_{ident} ? 6 : 0)) % 7;\n"));
    output.push_str(&format!("    const cal_total_{ident} = new Date(cal_y_{ident}, cal_m_{ident} + 1, 0).getDate();\n"));
    output.push_str(&format!("    if (cal_days_{ident}) {{\n"));
    output.push_str(&format!("      for (let i = 0; i < cal_pad_{ident}; i++) {{ const c = document.createElement('div'); c.className = 'vw-cal-cell pad'; cal_days_{ident}.appendChild(c); }}\n"));
    output.push_str(&format!("      for (let d = 1; d <= cal_total_{ident}; d++) {{\n"));
    output.push_str(&format!("        const key = cal_y_{ident} + '-' + String(cal_m_{ident} + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');\n"));
    output.push_str(&format!("        const c = document.createElement('div');\n"));
    output.push_str(&format!("        c.className = 'vw-cal-cell' + (cal_events_{ident}[key] ? ' event' : '') + (d === cal_now_{ident}.getDate() ? ' today' : '');\n"));
    output.push_str(&format!("        c.textContent = d;\n"));
    output.push_str(&format!("        if (cal_events_{ident}[key]) c.title = cal_events_{ident}[key];\n"));
    output.push_str(&format!("        cal_days_{ident}.appendChild(c);\n"));
    output.push_str("      }\n");
    output.push_str("    }\n");
    output.push_str("  }\n");
}

/// Swaps a rollover image to its hover picture on mouseenter and back on mouseleave.
fn emit_rollover(element: &Element, output: &mut String) {
    let selector = format!("[data-vw-id=\\\"{}\\\"]", js_string(&element.id));
    let ident = js_identifier(&element.id);
    output.push_str(&format!("  const roll_{ident} = document.querySelector('{selector}');\n"));
    output.push_str(&format!("  if (roll_{ident}) {{\n"));
    output.push_str(&format!("    const roll_base_{ident} = roll_{ident}.getAttribute('src');\n"));
    output.push_str(&format!("    roll_{ident}.addEventListener('mouseenter', () => {{ roll_{ident}.src = roll_{ident}.getAttribute('data-rollover') || roll_base_{ident}; }});\n"));
    output.push_str(&format!("    roll_{ident}.addEventListener('mouseleave', () => {{ roll_{ident}.src = roll_base_{ident}; }});\n"));
    output.push_str("  }\n");
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

/// The class written into the exported HTML and CSS selectors: the user's CSS class
/// property when set, otherwise the generated vw-<id> fallback. `data-vw-id` is always
/// emitted too, so behaviors keep working however the class is named.
fn export_class(element: &Element) -> String {
    element.attributes.get("class").map(String::as_str).and_then(user_class)
        .unwrap_or_else(|| format!("vw-{}", element.id.replace('-', "")))
}

/// Sanitizes a user-typed class name: anything outside [A-Za-z0-9_-] becomes a dash
/// (spaces included, so one input yields one class) and a leading digit gets an
/// underscore prefix. None when nothing usable remains.
fn user_class(value: &str) -> Option<String> {
    let cleaned: String = value.trim().chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' }).collect();
    if !cleaned.chars().any(|ch| ch.is_ascii_alphanumeric() || ch == '_') { return None; }
    if cleaned.chars().next().is_some_and(|ch| ch.is_ascii_digit()) { return Some(format!("_{cleaned}")); }
    Some(cleaned)
}

fn allowed_attribute(kind: &str, name: &str) -> bool {
    match kind {
        "image" => matches!(name, "src" | "alt" | "title" | "loading"),
        "rollover" => matches!(name, "src" | "alt" | "data-rollover" | "title" | "loading"),
        "iframe" => matches!(name, "src" | "title" | "width" | "height" | "allow" | "allowfullscreen" | "loading" | "name" | "referrerpolicy" | "sandbox"),
        "video" => matches!(name, "src" | "poster" | "controls" | "autoplay" | "loop" | "muted" | "preload" | "title"),
        "audio" => matches!(name, "src" | "controls" | "autoplay" | "loop" | "muted" | "preload" | "title"),
        "button" | "link" => matches!(name, "href" | "target" | "rel" | "title"),
        "input" => matches!(name, "type" | "placeholder" | "name" | "required" | "value" | "aria-label"),
        "textbox" => matches!(name, "name" | "placeholder" | "rows" | "required" | "aria-label"),
        "dropdown" => matches!(name, "name" | "required" | "aria-label"),
        "datetime" => matches!(name, "name" | "required"),
        "checkbox" | "radio" => matches!(name, "name" | "aria-label"),
        "form" => matches!(name, "action" | "method" | "name"),
        _ => matches!(name, "title" | "aria-label" | "role"),
    }
}

fn js_string(value: &str) -> String { value.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', " ") }
fn escape_html(value: &str) -> String { value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;") }
fn safe_filename(value: &str) -> String { value.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' }).collect() }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_user_classes() {
        assert_eq!(user_class("hero-banner"), Some("hero-banner".into()));
        assert_eq!(user_class("Hero Section!"), Some("Hero-Section-".into()));
        assert_eq!(user_class("9grid"), Some("_9grid".into()));
        assert_eq!(user_class("  spaced_name "), Some("spaced_name".into()));
        assert_eq!(user_class("!!!"), None);
        assert_eq!(user_class(""), None);
    }

    #[test]
    fn export_class_falls_back_to_generated_id() {
        let mut element = Element::new("heading");
        assert!(export_class(&element).starts_with("vw-"));
        element.attributes.insert("class".into(), "my heading".into());
        assert_eq!(export_class(&element), "my-heading");
        element.attributes.insert("class".into(), "***".into());
        assert!(export_class(&element).starts_with("vw-"));
    }

    #[test]
    fn calendar_exports_shell_and_embeds_events() {
        let mut element = Element::new("calendar");
        element.content = "Events".into();
        element.attributes.insert("events".into(), r#"[{"date":"2026-11-05","title":"Bake sale"}]"#.into());
        let mut html = String::new();
        render_elements(&[element.clone()], 0, &mut html, &Default::default());
        assert!(html.contains("vw-cal-days"));
        assert!(html.contains("Events"));
        assert!(!html.contains("Bake sale"), "events live in the script, not the HTML");
        let mut js = String::new();
        emit_calendar(&element, &mut js);
        assert!(js.contains("2026-11-05") && js.contains("Bake sale"));
        // Malformed event JSON must not break the calendar.
        element.attributes.insert("events".into(), "not json".into());
        assert!(calendar_events(&element).is_empty());
    }

    #[test]
    fn table_and_strip_export_from_attributes() {
        let mut table = Element::new("table");
        table.attributes.insert("cells".into(), r#"[["A","B","C"],["1","2","3"]]"#.into());
        assert_eq!(table_cells(&table, 2, 3)[1][2], "3");
        // Resizing keeps overlapping content and pads the rest with empty cells.
        assert_eq!(table_cells(&table, 3, 4)[2][3], "");
        assert_eq!(table_cells(&table, 1, 1)[0][0], "A");
        table.attributes.insert("cells".into(), "broken".into());
        assert_eq!(table_cells(&table, 2, 2)[1][1], "");

        let mut strip = Element::new("strip");
        strip.content = "Hello".into();
        let mut html = String::new();
        render_elements(&[strip.clone()], 0, &mut html, &Default::default());
        assert!(html.contains("vw-strip") && html.contains("Hello") && !html.contains("background-image"));
        strip.attributes.insert("src".into(), r"C:\pics\banner.jpg".into());
        let mut media = std::collections::HashMap::new();
        media.insert(r"C:\pics\banner.jpg".to_string(), "media/banner.jpg".to_string());
        let mut html = String::new();
        render_elements(&[strip], 0, &mut html, &media);
        assert!(html.contains("url('media/banner.jpg')"));
    }
}
