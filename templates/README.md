# Stretchable Strips Template Documentation

## Overview
This template provides flexible, stretchable strips that adapt to window resizing for use with WeaveCatcher website builder.

## Files Included
- `stretchable-strips-template.html` - Complete HTML template with embedded CSS
- `stretchable-strips.css` - CSS-only version for more flexibility

## Usage Instructions

### 1. HTML Template (stretchable-strips-template.html)
Simply open this file in WeaveCatcher or copy the content into your project. The template includes:
- Header strip
- Content strip with flexible columns
- Full-height content strip
- Footer strip
- Various color schemes and utility classes

### 2. CSS Template (stretchable-strips.css)
To use the CSS-only version:
1. Include the CSS file in your HTML:
```html
<link rel="stylesheet" href="path/to/stretchable-strips.css">
```
2. Use the provided classes in your HTML structure:
```html
<div class="strip-container">
  <div class="header-strip">...</div>
  <div class="content-strip">
    <div class="content-main stretchable-content">...</div>
    <div class="content-sidebar stretchable-content">...</div>
  </div>
  <div class="footer-strip">...</div>
</div>
```

## Key Features

### Flexbox Layout
The template uses CSS flexbox for flexible, stretchable containers:
- `strip-container` - Main container for all strips
- `strip-row` - Horizontal layout for strips
- `strip-column` - Vertical layout for strips
- `stretchable-content` - Content that stretches to fill available space

### Responsive Design
The template includes media queries for different screen sizes:
- Adjusts column layout on smaller screens
- Maintains usability on mobile devices

### Customizable Classes
- Color schemes: `.strip-primary`, `.strip-secondary`, `.strip-success`, etc.
- Padding: `.strip-padding-small`, `.strip-padding-medium`, `.strip-padding-large`
- Margins: `.strip-margin-small`, `.strip-margin-medium`, `.strip-margin-large`
- Border radius: `.strip-rounded`, `.strip-rounded-lg`, `.strip-rounded-xl`
- Shadows: `.strip-shadow`, `.strip-shadow-lg`

### Layout Examples

#### Basic Strip Container
```html
<div class="strip-container">
  <div class="header-strip">Header</div>
  <div class="content-strip">
    <div class="content-main stretchable-content">Main Content</div>
    <div class="content-sidebar stretchable-content">Sidebar</div>
  </div>
  <div class="footer-strip">Footer</div>
</div>
```

#### Full Height Strip
```html
<div class="full-height-strip">
  <div class="full-height-content stretchable-content">
    Content that fills available vertical space
  </div>
</div>
```

#### Grid Layout
```html
<div class="stretchable-grid">
  <div class="grid-item">Item 1</div>
  <div class="grid-item">Item 2</div>
  <div class="grid-item">Item 3</div>
</div>
```

## Best Practices

1. **Use `min-height: 0` and `min-width: 0`** - Important for proper flex stretching
2. **Avoid fixed widths** - Use flex properties for better responsiveness
3. **Test on different screen sizes** - Ensure the layout works well on mobile and desktop
4. **Customize colors and spacing** - Adjust to match your design system

## Customization Tips

- Modify the color classes to match your brand colors
- Adjust padding and margins as needed
- Add additional utility classes for your specific use cases
- Combine with other CSS frameworks if needed

## Troubleshooting

If strips don't stretch properly:
1. Check that `flex: 1` is applied to the stretchable elements
2. Ensure `min-height: 0` and `min-width: 0` are set
3. Verify that the container has proper dimensions
4. Check for conflicting CSS rules

## Contributing
Feel free to modify and extend this template. Add new features, improve responsiveness, or create additional layout examples.