---
name: Zebra Identity
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f3'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1b1b1b'
  on-surface-variant: '#4c4546'
  inverse-surface: '#303030'
  inverse-on-surface: '#f1f1f1'
  outline: '#7e7576'
  outline-variant: '#cfc4c5'
  surface-tint: '#5e5e5e'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1b1b1b'
  on-primary-container: '#848484'
  inverse-primary: '#c6c6c6'
  secondary: '#5f5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2dfde'
  on-secondary-container: '#636262'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1b1b1b'
  on-tertiary-container: '#848484'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2e2e2'
  primary-fixed-dim: '#c6c6c6'
  on-primary-fixed: '#1b1b1b'
  on-primary-fixed-variant: '#474747'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c6'
  on-tertiary-fixed: '#1b1b1b'
  on-tertiary-fixed-variant: '#474747'
  background: '#f9f9f9'
  on-background: '#1b1b1b'
  surface-variant: '#e2e2e2'
  ink-900: '#111111'
  ink-600: '#4A4A4A'
  ink-400: '#8C8C8C'
  surface-1: '#FFFFFF'
  surface-2: '#F5F5F5'
  accent: '#000000'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  code-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  margin-sm: 16px
  margin-lg: 32px
  gutter: 16px
  container-max: 1280px
---

## Brand & Style

The design system is rooted in the "Zebra" visual identity—a philosophy of absolute precision, functional minimalism, and high-fidelity utility. It is designed for B2B SaaS environments where clarity and density of information are paramount. 

The aesthetic is **Modern Minimalist with Brutalist leanings**: it utilizes a strictly monochromatic palette, hairline borders, and monospaced accents to evoke a sense of engineering excellence. The interface should feel like a high-end tool—neutral yet authoritative, favoring structural clarity over decorative flair. Key emotional drivers are reliability, efficiency, and industrial sophistication.

## Colors

This design system adheres to a strict monochrome palette. **Black** and **White** form the foundation, supported by a technical "Ink" ramp for varying degrees of text and UI prominence. 

- **Primary**: Pure black is used for primary actions, headings, and high-contrast elements.
- **Secondary**: Deep grays are reserved for secondary text and borders.
- **Neutral**: The background relies on a tiered system. While the default mode is `light`, the hierarchy is built using `--surface-1` (pure white for cards) and `--surface-2` (a recessed gray for the page background), ensuring that card-based layouts have clear containment.
- **Accent**: Selection and active states are defined by a border color change to the accent (black) or a subtle shadow, rather than changing the border weight.

## Typography

Typography is used to create a clear information hierarchy and a technical "pro" feel.

- **UI Text (Inter)**: Used for all standard interface elements. Headings are strictly `SemiBold (600)` to provide weight without becoming bulky. 
- **Code & Data (JetBrains Mono)**: Used for technical data, monospaced labels, and code snippets. This differentiates "system output" from "UI labels."
- **Cifras (Numbers)**: Large numerical values should be set to `Bold (700)` to emphasize performance metrics.
- **Accessibility**: Avoid using light grays (`ink-400` or below) for any body text or essential labels to maintain AA compliance.

## Layout & Spacing

The layout is built on a **12-column fixed grid** for desktop and a single-column fluid layout for mobile. 

- **The Recessed Surface**: This design system utilizes a specific "recessed" layout model. The page background is typically `--surface-2`, with content grouped into `--surface-1` cards.
- **Density**: Use a tight 4px-based spacing rhythm. Components should feel compact and data-rich.
- **Gutters & Margins**: Use 16px gutters between columns. Desktop margins are set to 32px, scaling down to 16px on mobile devices.
- **Breakpoints**: 
  - Mobile: < 768px (Single column, 16px margin)
  - Tablet: 768px - 1024px (8 columns, 24px margin)
  - Desktop: > 1024px (12 columns, 32px margin)

## Elevation & Depth

Hierarchy is achieved through **Tonal Layers** and **Hairline Outlines** rather than heavy shadows.

- **Depth Levels**: 
  - **Level 0 (Background)**: `--surface-2` (Recessed).
  - **Level 1 (Cards/Containers)**: `--surface-1` (Pure White or pure black in dark mode) with a 1px hairline border.
  - **Level 2 (Overlays/Modals)**: Increased contrast with a subtle, tight ambient shadow (Blur 12px, Opacity 5%, Color: Black).
- **Outlines**: Use 1px hairline borders for all structural elements. Active states should never increase border weight; instead, change the color of the 1px border to `--accent` and add a subtle focus ring.
- **Decor**: Use the dot-grid pattern sparingly to define sections or provide subtle background texture in large empty states.

## Shapes

The shape language is precise and controlled. The standard corner radius is **12px** for cards, buttons, and input fields, creating a "soft-square" aesthetic that balances the brutalist monochrome palette. 

- **Small elements**: Tags or chips may use a reduced 4px or 6px radius to maintain visual proportion.
- **Icons**: Use Lucide icons with a 1.5px stroke width to match the hairline aesthetic of the borders.

## Components

- **Buttons**: Primary buttons are solid black with white Inter Semibold text. Secondary buttons are white/transparent with a 1px border.
- **Input Fields**: 1px hairline border in `ink-200` (or appropriate gray). On focus, the border transitions to black with a high-fidelity focus ring.
- **Cards**: Must have a white background (`--surface-1`), 12px border radius, and a 1px hairline border. They should always sit on a recessed background (`--surface-2`).
- **Chips/Labels**: Use JetBrains Mono for a "metadata" feel. Backgrounds should be very light gray or outlined.
- **Selection States**: Indicated by a color shift to the accent token. Never thicken borders as it causes layout shift.
- **Interactive Elements**: Use a fine, animated focus state (ZR-18) and hover transitions that feel immediate and snappy.