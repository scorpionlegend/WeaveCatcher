# Website Builder Desktop Application

## 1. Application Overview

A cross-platform desktop application for designing and building websites visually. Users can add elements to a page, arrange them with drag and drop, customize their appearance, add common interactions, and export the result as website files.

The application combines a visual editor with code viewing and export capabilities. It is intended to support both beginners who prefer visual tools and developers who want to inspect the generated HTML, CSS, and JavaScript.

## 2. Intended Users

- People learning how websites are built.
- Designers who want to create pages visually.
- Developers who want a visual starting point for a website.
- Small businesses and hobbyists creating simple websites.

## 3. Main Application Areas

### 3.1 Project Manager

The project manager is where users create, open, and organize website projects.

It should support:

- Creating a new project.
- Opening an existing project.
- Saving project changes.
- Managing multiple pages within a project.
- Choosing where project files are stored.
- Warning users about unsaved changes before closing or switching projects.

### 3.2 Website Editor

The website editor is the main workspace. It contains the page canvas and the tools used to build and edit a website.

The editor should provide:

- A visual page canvas.
- An element palette.
- A properties inspector.
- A layers or page-structure panel.
- A pages panel.
- A code view.
- A choice between classic and modern toolbar layouts.

### 3.3 Visual Canvas

The canvas displays the page being edited. It should render the page using HTML and CSS so users can see a close representation of the result.

Canvas capabilities:

- Select an element by clicking it.
- Highlight the selected element.
- Show an outline when hovering over an element.
- Display the selected element’s location in the page structure.
- Support adding and moving elements with drag and drop.
- Preview interactive behaviors where practical.

The canvas is an editor view. The saved project model, rather than the rendered canvas, stores the project’s structure and settings.

### 3.4 Element Palette

The element palette contains items users can add to a page.

Possible elements include:

- Section
- Container
- Heading
- Paragraph
- Image
- Button
- Link
- List
- Form field
- Divider
- Spacer

Users should be able to drag an element from the palette and drop it onto a valid location on the canvas.

### 3.5 Properties Inspector

The properties inspector displays settings for the currently selected element. The available controls depend on the element type.

Examples include:

- Text content.
- Link destination.
- Image source and alternative text.
- Width and height.
- Margins and padding.
- Text color and background color.
- Font family, size, weight, and alignment.
- Borders and corner radius.
- Flexbox or Grid layout options.
- Accessibility-related labels and attributes.

### 3.6 Layers Panel

The layers panel shows the structure of the current page as a tree.

Users should be able to:

- Select an element from the tree.
- Understand which elements are nested inside others.
- Reorder elements where valid.
- Rename elements for easier identification.
- Hide or show elements in the editor without deleting them.

### 3.7 Pages Panel

The pages panel displays the pages that belong to the project.

Users should be able to:

- Add a page.
- Rename a page.
- Delete a page.
- Switch between pages.
- Set a page as the home page.

### 3.8 Code View

Code view displays the code generated from the current project.

It should support viewing:

- HTML structure.
- CSS styles.
- JavaScript behaviors.

A split view can display the visual canvas and generated code at the same time. In the initial version, the project model should remain the source of truth; editing generated code directly can be considered later if reliable synchronization is designed.

## 4. Editor Layout Options

Users can choose between two editor layouts. Both layouts provide the same editing features.

### 4.1 Classic Layout

A traditional layout with:

- A horizontal menu bar at the top.
- A toolbar below or alongside the menu bar.
- Menus such as File, Edit, Insert, Format, and View.
- Buttons for common editing actions.

### 4.2 Modern Layout

A sidebar-focused layout with:

- A left-side icon rail.
- Panels for adding elements, managing pages, viewing layers, and changing settings.
- A contextual toolbar near the selected element when useful.
- Expandable panels that keep the canvas prominent.

The selected layout should be saved as a user preference and changed without restarting the application.

## 5. Website Technologies

### 5.1 HTML

HTML defines the structure and content of the website, such as headings, paragraphs, images, links, and forms.

### 5.2 CSS

CSS controls the appearance and layout of the website, including colors, spacing, typography, Flexbox, and Grid.

### 5.3 JavaScript

JavaScript adds behavior and interaction to the website. The application can provide common interactions through visual settings, then generate JavaScript when the project is exported.

### 5.4 Server-Side Technologies

Languages and frameworks such as Python, Flask, Django, PHP, and server-side Node.js are different from browser-based HTML, CSS, and JavaScript. They typically require a server runtime and may involve databases or hosting.

These technologies are not part of the initial application scope. They could be considered later as project scaffolding or export options.

## 6. Behaviors and Interactions

A Behaviors panel lets users configure common interactions without having to write JavaScript themselves.

Potential behaviors include:

- Open a URL when a button is clicked.
- Scroll to another section of the page.
- Show or hide an element.
- Open or close a simple modal.
- Check that required form fields are filled in.
- Display a form success message.
- Show an image gallery or lightbox.
- Start a simple animation when an element appears on screen.

Behavior settings should be stored with the project data and converted into JavaScript during export.

## 7. Project Data and Files

A project should contain the data needed to reconstruct the website in the editor.

Project data may include:

- Project settings.
- Page names and paths.
- The element tree for each page.
- Element content and attributes.
- Style settings.
- Behavior settings.
- Asset references, such as images.

The exported website should contain ordinary front-end files, such as:

- HTML files.
- CSS files.
- JavaScript files, when needed.
- Referenced images and other assets.

## 8. Export and Preview

Users should be able to export their project as a website and preview it in their default browser.

Export features should include:

- Readable, organized HTML.
- CSS for the page styling.
- JavaScript for configured behaviors.
- Project assets copied or referenced appropriately.
- Clear error messages if an export fails.
- A warning or confirmation before overwriting existing files.

## 9. Editing and Productivity Features

The editor should support common editing actions:

- Undo and redo.
- Copy and paste elements.
- Duplicate elements.
- Keyboard shortcuts.
- Save and save-as actions.
- Drag-and-drop reordering.
- Confirmation before destructive actions.

## 10. Version 1 Scope

### Included

- Desktop project and page management.
- Visual canvas.
- Element palette.
- Drag-and-drop editing.
- Properties inspector.
- Layers and pages panels.
- Classic and modern editor layouts.
- Common configurable behaviors.
- HTML, CSS, and vanilla JavaScript export.
- Code viewing.
- Browser preview.
- Undo and redo.

### Not Included Initially

- Website hosting or deployment.
- Server-side code execution.
- Python, Flask, Django, PHP, or backend Node.js projects.
- Databases or CMS functionality.
- Collaborative editing.
- Template marketplace.
- Advanced responsive breakpoint editing.
- Direct editing and synchronization of generated code.

## 11. Possible Future Extensions

Possible later additions include:

- Responsive editing for desktop, tablet, and mobile layouts.
- React export.
- More advanced animation tools.
- Reusable components and templates.
- Additional project scaffolding options.
- Server-side project templates.
- Publishing and deployment integrations.

## 12. High-Level User Workflow

1. Create or open a project.
2. Add or select a page.
3. Drag elements onto the canvas.
4. Arrange the page structure.
5. Edit content and appearance in the properties inspector.
6. Configure interactions in the Behaviors panel.
7. Review the page in the visual canvas and code view.
8. Export the website.
9. Preview the exported website in a browser.
