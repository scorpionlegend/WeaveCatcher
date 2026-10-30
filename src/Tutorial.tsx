import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { applyTheme } from "./theme";

type Topic = "html" | "css" | "js" | "tour";
type Lesson = { title: string; intro: string; code?: string; codeLabel?: string; points?: string[] };
type Tutorial = { label: string; blurb: string; lessons: Lesson[] };

// ---------------------------------------------------------------------------
// Learn HTML / Learn CSS / Learn JavaScript — short slide-by-slide tutorials
// aimed at people building their first site, tied back to WeaveCatcher itself.
// ---------------------------------------------------------------------------

const TUTORIALS: Record<"html" | "css" | "js", Tutorial> = {
  html: {
    label: "Learn HTML",
    blurb: "HTML is the skeleton of every web page — the headings, paragraphs, images and links that hold your content.",
    lessons: [
      {
        title: "What is HTML?",
        intro: "HTML (HyperText Markup Language) describes the structure of a page. Your browser reads it and turns each piece into something you can see: a heading, a picture, a button. Every website you have ever visited is HTML at its core.",
        code: "<h1>Welcome to my site</h1>",
        codeLabel: "The browser shows a big heading",
        points: [
          "HTML is not a programming language — it's a markup language. It labels content instead of giving instructions.",
          "WeaveCatcher builds this HTML for you while you work visually, but understanding it helps you read and fine-tune the result.",
        ],
      },
      {
        title: "Tags and elements",
        intro: "An HTML element usually has an opening tag, some content, and a closing tag with a slash. The tag name says what the content is.",
        code: "<p>This is a paragraph.</p>\n<img src=\"photo.jpg\" alt=\"My photo\">",
        codeLabel: "A paragraph, and an image (which needs no closing tag)",
        points: [
          "<p> opens and </p> closes — the slash means 'end of this element'.",
          "Some elements, like images, have no content of their own, so they close themselves.",
          "Tags can carry attributes inside the opening tag — src tells an image which file to show, alt describes it for screen readers.",
        ],
      },
      {
        title: "Headings and paragraphs",
        intro: "Headings come in six levels, <h1> (most important) down to <h6>. Paragraphs use <p>. Search engines use headings to understand what your page is about, so keep one clear <h1> per page.",
        code: "<h1>My Bakery</h1>\n<p>Fresh bread every morning since 1998.</p>\n<h2>Opening hours</h2>\n<p>Monday to Saturday, 7am to 3pm.</p>",
        points: [
          "WeaveCatcher's Heading module creates an <h2> — perfect for section titles under a page title.",
          "The Paragraph module creates <p>. Type into it directly on the canvas.",
        ],
      },
      {
        title: "Links and images",
        intro: "Links and images are what make the web a web. A link points somewhere else; an image pulls a picture onto the page.",
        code: "<a href=\"https://example.com\">Visit our shop</a>\n<img src=\"croissant.jpg\" alt=\"A fresh croissant\">",
        points: [
          "href is the address the link goes to.",
          "Always give images an alt text — it shows while the picture loads and is read aloud by assistive technology.",
          "In WeaveCatcher, the Link and Image modules map to exactly these tags, with fields for the URL and alt text in Properties.",
        ],
      },
      {
        title: "Lists",
        intro: "Lists group related items. An unordered list (<ul>) shows bullet points; an ordered list (<ol>) numbers them. Each item inside is an <li>.",
        code: "<ul>\n  <li>Flour</li>\n  <li>Water</li>\n  <li>Salt</li>\n</ul>",
        points: [
          "WeaveCatcher's Unordered and Ordered list modules create these for you, and you can pick the bullet symbol in Properties.",
          "Menus are usually lists of links inside a <nav> — that's what the Navbar module builds.",
        ],
      },
      {
        title: "Containers: div and section",
        intro: "Containers hold other elements together so you can move and style them as one unit. <section> marks a meaningful chunk of a page; <div> is a neutral box with no special meaning.",
        code: "<section class=\"hero\">\n  <h1>Bake with us</h1>\n  <p>Classes every weekend.</p>\n</section>",
        points: [
          "The class=\"hero\" part is a hook for CSS — you'll meet it again in the CSS tutorial.",
          "WeaveCatcher's Section and Container modules are these two tags. Nesting things inside a container lets you restyle the whole group at once.",
        ],
      },
      {
        title: "How WeaveCatcher writes your HTML",
        intro: "Every module you drop on the canvas is a real HTML element, and the code panel (Code view) shows the exact HTML WeaveCatcher generates. When you export, it's written to your folder as index.html.",
        points: [
          "Try it: switch to Code view and click elements on the canvas — watch the matching line highlight the structure.",
          "The CSS class field in Properties gives an element a readable class name, like hero-banner, instead of a generated one — much easier to spot in the HTML and CSS.",
          "Want to hand-edit? Anything you write in the code panel's HTML tab is used at export exactly as written.",
        ],
      },
    ],
  },
  css: {
    label: "Learn CSS",
    blurb: "CSS is the paint and layout of the web — colors, fonts, spacing and where everything sits on the page.",
    lessons: [
      {
        title: "What is CSS?",
        intro: "CSS (Cascading Style Sheets) describes how HTML should look. Where HTML says 'this is a heading', CSS says 'headings on this site are dark blue and 32 pixels tall'.",
        code: "h1 {\n  color: #2c3e6b;\n  font-size: 32px;\n}",
        codeLabel: "Every <h1> on the page becomes dark blue",
        points: [
          "One CSS file can style an entire site — that's why WeaveCatcher exports a single styles.css for all your pages.",
        ],
      },
      {
        title: "Rules, properties and selectors",
        intro: "A CSS rule has a selector (what to style), and declarations inside curly braces (how to style it). Each declaration is a property, a colon, a value, and a semicolon.",
        code: "p {\n  color: #444444;\n  line-height: 1.6;\n}",
        points: [
          "p selects every paragraph. dot-names like .intro select everything whose class is intro.",
          "Classes are the workhorse of CSS — that's why every WeaveCatcher element has a CSS class field in Properties.",
        ],
      },
      {
        title: "Classes — CSS's favorite hook",
        intro: "A class is a label you invent and attach to any element: <p class=\"intro\">. The CSS .intro rule then applies to every element wearing that label.",
        code: ".intro {\n  font-size: 18px;\n  color: #666666;\n}",
        codeLabel: "Styles any element with class=\"intro\"",
        points: [
          "Class names should describe purpose, not looks: hero-banner beats big-blue-box-2.",
          "Set a class in WeaveCatcher via Properties > CSS class, then use it in the code panel's CSS tab or your own stylesheet.",
        ],
      },
      {
        title: "The box model",
        intro: "Every element is a box with four layers: the content, padding (space inside the border), the border itself, and margin (space outside pushing neighbours away).",
        code: ".card {\n  padding: 16px;\n  border: 1px solid #dddddd;\n  margin: 24px;\n}",
        points: [
          "Padding pushes content away from the element's own edge; margin pushes other elements away from it.",
          "WeaveCatcher's Properties panel has Padding, Margin, Border and Radius fields — they write exactly these properties.",
        ],
      },
      {
        title: "Color and text",
        intro: "Colors can be names (tomato), hex codes (#e05b4b) or rgb values. Text gets a font, size, weight and alignment.",
        code: "h2 {\n  color: #1f2937;\n  font-family: Georgia, serif;\n  font-size: 22px;\n  text-align: center;\n}",
        points: [
          "Hex codes give exact colors; the little color picker next to each color field in Properties builds them for you.",
          "Font weight 400 is regular, 700 is bold — the Weight dropdown offers the common steps.",
        ],
      },
      {
        title: "Layout with flexbox",
        intro: "Flexbox arranges children in a row or a column and controls how they share space. Set display: flex on the parent, then steer with direction, gap, justify and align.",
        code: ".toolbar {\n  display: flex;\n  flex-direction: row;\n  gap: 12px;\n  justify-content: space-between;\n}",
        points: [
          "row lays children side by side; column stacks them.",
          "justify-content positions children along the main axis — space-between pushes the first and last to the edges.",
          "WeaveCatcher's Container module has a Display > Flex option with the same Direction, Gap, Justify and Align controls as this code.",
        ],
      },
      {
        title: "CSS in WeaveCatcher",
        intro: "You have been writing CSS all along: every change in the Properties panel becomes a CSS declaration, and the generated styles.css is shown in the code panel's CSS tab.",
        points: [
          "Switch to Code view, select an element and change its color — you'll see the rule update live.",
          "Style presets (Format menu) apply ready-made groups of these properties in one click.",
          "Anything you type in the CSS tab yourself is used at export exactly as written — handy for hover effects and other tricks the panel doesn't cover.",
        ],
      },
    ],
  },
  js: {
    label: "Learn JavaScript",
    blurb: "JavaScript makes a page react — menus that open, forms that check themselves, images that swap when you hover.",
    lessons: [
      {
        title: "What is JavaScript?",
        intro: "HTML is structure and CSS is style; JavaScript is behaviour. It's a real programming language that runs in the visitor's browser and can change the page after it has loaded.",
        code: "alert(\"Hello!\");",
        codeLabel: "Pops up a message when it runs",
        points: [
          "JavaScript responds to things happening — clicks, typing, scrolling — and edits the page in response.",
        ],
      },
      {
        title: "Variables and values",
        intro: "A variable is a named box for a value. const makes a box that never changes; let makes one that can.",
        code: "const name = \"WeaveCatcher\";\nlet visits = 0;\nvisits = visits + 1;",
        points: [
          "Text in quotes is a string; whole numbers are numbers; true/false are booleans.",
          "Names are case-sensitive: visits and Visits are different boxes.",
        ],
      },
      {
        title: "Functions",
        intro: "A function is a reusable recipe: give it a name, some steps, and call it whenever you need those steps to run.",
        code: "function greet(visitor) {\n  return \"Welcome, \" + visitor + \"!\";\n}\n\ngreet(\"Allen\"); // \"Welcome, Allen!\"",
        points: [
          "The words in the parentheses (visitor) are inputs; return hands a result back.",
          "Functions keep code tidy: write once, call many times.",
        ],
      },
      {
        title: "The DOM — JavaScript's view of the page",
        intro: "When the browser loads your HTML, it builds the DOM: a live object tree your script can search and change. Change the DOM and the page changes instantly.",
        code: "const button = document.querySelector(\".signup\");\nbutton.textContent = \"Sign me up!\";",
        points: [
          "document.querySelector finds the first element matching a CSS selector — classes strike again.",
          "Every element WeaveCatcher exports carries data-vw-id, so generated scripts always find their targets even if you rename classes.",
        ],
      },
      {
        title: "Events — reacting to the visitor",
        intro: "An event listener waits for something to happen (a click, a key press) and runs your function when it does. This is the heart of interactivity.",
        code: "button.addEventListener(\"click\", () => {\n  button.classList.toggle(\"is-hidden\");\n});",
        points: [
          "The part after the comma is a shortcut function that runs on every click.",
          "classList.toggle adds a CSS class if it's missing and removes it if it's there — one line, instant show/hide.",
        ],
      },
      {
        title: "A tiny working example",
        intro: "Put the pieces together: find a button, count clicks, and update a paragraph. This is genuinely all you need for many site features.",
        code: "let count = 0;\nconst button = document.querySelector(\"#like\");\nconst label = document.querySelector(\".like-count\");\n\nbutton.addEventListener(\"click\", () => {\n  count = count + 1;\n  label.textContent = count + \" likes\";\n});",
        codeLabel: "A working like button",
        points: [
          "WeaveCatcher's generated script.js is built from these same ingredients — querySelector, addEventListener and small functions.",
        ],
      },
      {
        title: "JavaScript in WeaveCatcher",
        intro: "You get JavaScript without writing any: Behaviors (in the left panel) compile to plain JavaScript at export. A 'on click, toggle element' behavior becomes an addEventListener call exactly like the one above.",
        points: [
          "Open the code panel's JS tab after adding a behavior to see the code it produced.",
          "Rollover images and required-field form checks are behaviors WeaveCatcher writes for you automatically.",
          "Need something custom? Code you paste into the JS tab is added to the exported script.js as-is.",
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// "How to use WeaveCatcher" — a visual walkthrough. Each step spotlights one
// region of a miniature workspace drawing.
// ---------------------------------------------------------------------------

const TOUR: { title: string; text: string; highlight: string }[] = [
  {
    title: "Welcome to WeaveCatcher",
    text: "WeaveCatcher builds real websites while you work visually. Drag things onto the page, style them with a click, and export a folder of plain HTML, CSS and JavaScript that works anywhere. This short tour points out the main areas — the numbers repeat in the panel titles on screen.",
    highlight: "canvas",
  },
  {
    title: "Add elements from the palette",
    text: "The ADD panel (top left) holds every building block, grouped like the toolboxes in Dreamweaver: Layout, HTML, Media, Forms and more. Click a module — Heading, Image, Button, Gallery — and it drops straight onto your page, or drag it exactly where you want it.",
    highlight: "add",
  },
  {
    title: "The canvas is your page",
    text: "The centre stage is a live draft of your page. Click any element to select it, drag to rearrange, and press Delete to remove the selection. Media elements get window-style resize handles; Section, Container and Grid elements resize in height like in Dreamweaver.",
    highlight: "canvas",
  },
  {
    title: "Edit what you selected",
    text: "The PROPERTIES panel on the right shows the selected element's settings: text, link addresses, image sources, and — under the hood — its CSS class name. Every field you see here ends up as real HTML attributes in the exported site.",
    highlight: "properties",
  },
  {
    title: "Style without touching code",
    text: "Still in Properties, the Appearance and Layout sections write the CSS for you: colors, fonts, padding, borders, flexbox alignment. For instant looks, the THEME panel applies style presets like Soft card or Midnight to the selected element.",
    highlight: "properties",
  },
  {
    title: "Layers — the map of your page",
    text: "The LAYERS panel lists every element on the page as a tree, just like the DOM. Click to select, drag to reorder or nest, double-click a name to rename it. Deeply nested page? Layers finds things the canvas click might miss.",
    highlight: "layers",
  },
  {
    title: "Behaviors — interactivity without JavaScript",
    text: "Select an element, open BEHAVIORS, and wire up 'when this is clicked, then do that': open a link, show or hide a menu, scroll to a section, validate a form. WeaveCatcher compiles each behavior into plain JavaScript on export — open the JS tab in code view to see it.",
    highlight: "layers",
  },
  {
    title: "Pages and files",
    text: "The PAGES panel manages the pages of your site; each becomes its own HTML file on export, with links between them kept working. The FILES panel opens any folder on your computer so you can keep your project and exported site in view — click a text file to edit it right inside WeaveCatcher.",
    highlight: "dock",
  },
  {
    title: "Code view and Live preview",
    text: "The tabs above the canvas switch between Canvas, Split and Code view — in Split you see the page and the generated HTML/CSS/JS together, editing either side. The ▾ dropdown next to it flips the stage between Design (editable) and Live (a real preview of the exported page).",
    highlight: "toolbar",
  },
  {
    title: "Export and ship it",
    text: "When you're happy, File > Export website… writes a folder with index.html, styles.css, script.js and a media folder — no build tools, no dependencies, upload it to any host. That's the whole loop: add, style, preview, export. Enjoy building!",
    highlight: "toolbar",
  },
];

function TourStage({ highlight }: { highlight: string }) {
  const spot = (key: string) => `tour-spot${highlight === key ? " spotlit" : ""}`;
  return <div class="tour-stage" aria-hidden="true">
    <div class={spot("toolbar")}>
      <span class="tour-dot" /><span class="tour-dot" /><span class="tour-dot" />
      <span class="tour-tab" /><span class="tour-tab" /><span class="tour-tab" />
      <span class="tour-spacer" /><span class="tour-btn" />
    </div>
    <div class="tour-body">
      <div class="tour-rail">
        <div class={`${spot("add")} tour-add`}><span class="tour-rail-icon">＋</span><span class="tour-rail-label">ADD</span></div>
        <div class={`${spot("layers")} tour-layers`}><span class="tour-rail-icon">☰</span><span class="tour-rail-label">LAYERS</span></div>
      </div>
      <div class={spot("canvas")}>
        <span class="tour-block heading" /><span class="tour-block wide" /><span class="tour-block pair" /><span class="tour-block" />
      </div>
      <div class="tour-rail tour-rail-wide">
        <div class={`${spot("properties")} tour-properties`}>
          <span class="tour-field" /><span class="tour-field" /><span class="tour-field short" /><span class="tour-swatch" />
        </div>
      </div>
    </div>
    <div class={spot("dock")}><span class="tour-tab" /><span class="tour-tab" /></div>
  </div>;
}

export function TutorialApp() {
  const [topic, setTopic] = useState<Topic>("tour");
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    applyTheme();
    invoke<string>("get_help_topic").then((value) => {
      if (value === "html" || value === "css" || value === "js" || value === "tour") { setTopic(value); setSlide(0); }
    }).catch(() => { /* fall back to the tour */ });
    const unlisten = listen<string>("help-topic", (event) => {
      const value = event.payload;
      if (value === "html" || value === "css" || value === "js" || value === "tour") { setTopic(value); setSlide(0); }
    });
    return () => { void unlisten.then((off) => off()); };
  }, []);

  if (topic === "tour") {
    const step = TOUR[slide];
    const last = slide === TOUR.length - 1;
    return <main class="tutorial-window">
      <div class="tutorial-content">
        <p class="section-label">HOW TO USE WEAVECATCHER</p>
        <TourStage highlight={step.highlight} />
        <h2 class="lesson-title">{step.title}</h2>
        <p class="lesson-intro">{step.text}</p>
        <div class="lesson-nav">
          <button class="ghost-button" disabled={slide === 0} onClick={() => setSlide(slide - 1)}>← Back</button>
          <div class="lesson-dots">{TOUR.map((_, index) => <button key={index} class={index === slide ? "active" : ""} onClick={() => setSlide(index)} title={`Step ${index + 1}`} />)}</div>
          <button class="primary-button" onClick={() => (last ? setSlide(0) : setSlide(slide + 1))}>{last ? "Start over" : "Next →"}</button>
        </div>
        <p class="lesson-count">Step {slide + 1} of {TOUR.length}</p>
      </div>
    </main>;
  }

  const tutorial = TUTORIALS[topic];
  const lesson = tutorial.lessons[slide];
  const last = slide === tutorial.lessons.length - 1;
  return <main class="tutorial-window">
    <div class="tutorial-content">
      <p class="section-label">{tutorial.label.toUpperCase()}</p>
      <p class="tutorial-blurb">{tutorial.blurb}</p>
      <div class="lesson-tabs">
        {tutorial.lessons.map((item, index) => <button key={item.title} class={index === slide ? "active" : ""} onClick={() => setSlide(index)}>{index + 1}. {item.title}</button>)}
      </div>
      <h2 class="lesson-title">{lesson.title}</h2>
      <p class="lesson-intro">{lesson.intro}</p>
      {lesson.code && <div class="lesson-code-wrap"><pre class="lesson-code"><code>{lesson.code}</code></pre>{lesson.codeLabel && <p class="lesson-code-label">{lesson.codeLabel}</p>}</div>}
      {lesson.points && <ul class="lesson-points">{lesson.points.map((point) => <li key={point}>{point}</li>)}</ul>}
      <div class="lesson-nav">
        <button class="ghost-button" disabled={slide === 0} onClick={() => setSlide(slide - 1)}>← Back</button>
        <div class="lesson-dots">{tutorial.lessons.map((_, index) => <button key={index} class={index === slide ? "active" : ""} onClick={() => setSlide(index)} title={tutorial.lessons[index].title} />)}</div>
        <button class="primary-button" onClick={() => (last ? setSlide(0) : setSlide(slide + 1))}>{last ? "Start over" : "Next →"}</button>
      </div>
      <p class="lesson-count">Lesson {slide + 1} of {tutorial.lessons.length}</p>
    </div>
  </main>;
}
