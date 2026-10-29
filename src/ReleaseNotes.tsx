import { useEffect, useState } from "preact/hooks";
import { getVersion } from "@tauri-apps/api/app";
import { applyTheme } from "./theme";

const RELEASES: { version: string; date: string; highlights: string[] }[] = [
  {
    version: "0.1.6",
    date: "October 29, 2026",
    highlights: [
      "New MEDIA category: image, rollover image, gallery, video, audio and iframe modules",
      "Rollover images swap to a second picture on hover, in the editor and in the exported site",
      "Gallery module starts as a 3-column grid of images you can edit one by one",
      "LISTS category with unordered and ordered list modules",
      "Settings moved into its own window, now with a theme switcher",
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
