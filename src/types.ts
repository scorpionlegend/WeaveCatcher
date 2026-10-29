export type Behavior = {
  trigger: "on_click" | "on_submit" | "on_scroll";
  action: "open_url" | "scroll_to" | "toggle" | "open_modal" | "close_modal" | "validate_form" | "success_message" | "fade_in";
  target: string;
  value: string;
};

export type ElementNode = {
  id: string;
  kind: string;
  name: string;
  content: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  behaviors: Behavior[];
  hidden: boolean;
  children: ElementNode[];
};

export type Page = { id: string; name: string; slug: string; elements: ElementNode[]; customHtml: string };
export type DocumentModel = {
  schemaVersion: number;
  name: string;
  pages: Page[];
  activePageId: string;
  settings: { layout: "classic" | "modern" };
  customCss: string;
  customJs: string;
};
export type ExportBundle = { html: string; css: string; js: string };

export type EditIntent =
  | { type: "add_element"; kind: string; parentId?: string | null; index?: number }
  | { type: "update_content"; id: string; content: string }
  | { type: "set_style"; id: string; property: string; value: string }
  | { type: "set_attribute"; id: string; name: string; value: string }
  | { type: "rename_element"; id: string; name: string }
  | { type: "set_hidden"; id: string; hidden: boolean }
  | { type: "set_behaviors"; id: string; behaviors: Behavior[] }
  | { type: "move_element"; id: string; parentId?: string | null; index: number }
  | { type: "duplicate_element"; id: string }
  | { type: "delete_element"; id: string }
  | { type: "add_page"; name: string }
  | { type: "rename_page"; id: string; name: string }
  | { type: "delete_page"; id: string }
  | { type: "set_active_page"; id: string }
  | { type: "set_layout"; layout: "classic" | "modern" }
  | { type: "rename_project"; name: string }
  | { type: "set_custom_code"; html: string; css: string; js: string };
