import { useEffect, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { applyTheme } from "./theme";

const RELEASES: { version: string; date: string; highlights: string[] }[] = [
  {
    version: "0.2.0",
    date: "October 29, 2026",
    highlights: [
      "New WIDGETS category with seven ready-made modules: Event calendar, Text box, Rich text, Dropdown, Date & time boxes, Table and Strip",
      "Event calendar: shows the current month with today outlined, and the Manage Events editor highlights event days with a tooltip",
      "Strip: a full-width banner with a background image — pick from the online strip gallery, upload your own picture, or use an offline gradient",
      "Rich text: format text with bold, italic, underline, headings and bullet lists from Properties",
      "Table: set rows, columns and a header row, then type every cell in Properties",
      "New Help menu: Learn HTML, Learn CSS and Learn JavaScript tutorials, plus a visual step-by-step 'How to use WeaveCatcher' tour",
      "Every element now has a CSS class field in Properties, so exported HTML and CSS can use readable names instead of generated ones",
      "New auto-update toggle in Settings: with it on, updates download and install while WeaveCatcher runs instead of waiting for the next launch",
    ],
  },
  {
    version: "0.1.9",
    date: "October 29, 2026",
    highlights: [
      "New form elements: checkbox and radio button, with caption text, field names and a checked-by-default option",
      "Required fields: mark any form field as required and it shows a red asterisk",
      "Submitting a form with an empty required field now warns the visitor instead of sending",
      "Press Delete or Backspace to remove the selected element on the canvas",
      "New Light, Dark and System appearance modes in Settings; System follows your OS theme",
    ],
  },
  {
    version: "0.1.8",
    date: "October 29, 2026",
    highlights: [
      "Settings and release-notes windows now fit their window size instead of being cut off at the edge",
      "The settings button in the title bar is now a gear icon",
    ],
  },
  {
    version: "0.1.7",
    date: "October 29, 2026",
    highlights: [
      "Settings moved into its own window: open or save projects, check for updates and install them with progress",
      "Dark mode: switch the whole app between light and dark themes, remembered between launches",
      "Style presets: pick an element and apply quick looks like Soft card or Midnight from the new Theme panel",
      "New Format menu with shortcuts to style presets and behaviors",
      "Exported sites now include a media folder with copies of your images, videos and audio",
    ],
  },
  {
    version: "0.1.6",
    date: "October 29, 2026",
    highlights: [
      "New MEDIA category: image, rollover image, gallery, video, audio and iframe modules",
      "Rollover images swap to a second picture on hover, in the editor and in the exported site",
      "Gallery module starts as a 3-column grid of images you can edit one by one",
      "LISTS category with unordered and ordered list modules",
      "Open any folder on disk and browse its files in a resizable Files panel",
      "The title bar stays in place when switching between Classic and Modern layouts",
    ],
  },
  {
    version: "0.1.5",
    date: "October 29, 2026",
    highlights: [
      "Editable code panel: hand-write HTML, CSS and JavaScript that is used at export",
      "Split view can be side-by-side or stacked, with the canvas or code shown first",
      "Update checker polish",
    ],
  },
  {
    version: "0.1.4",
    date: "October 28, 2026",
    highlights: [
      "Categorized element palette with search",
      "Navbar, footer and grid elements",
      "Canvas, Split and Code view modes",
      "Move elements up and down directly from the canvas",
    ],
  },
  {
    version: "0.1.3",
    date: "October 28, 2026",
    highlights: [
      "Fixed drag-and-drop of elements on Windows",
    ],
  },
];

export function ReleaseNotesApp() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    applyTheme();
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  return <main class="release-window">
    <div class="panel-content release-content">
      <p class="section-label" style="margin-top: 0">WHAT'S NEW</p>
      {RELEASES.map((release) => <div class="release-entry" key={release.version}>
        <h3>Version {release.version}{release.version === version && <span class="release-badge">CURRENT</span>}</h3>
        <small>{release.date}</small>
        <ul>{release.highlights.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>)}
      <p class="settings-footnote">WeaveCatcher {version || ""}</p>
    </div>
  </main>;
}
