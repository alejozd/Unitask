---
name: Academic Flow
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464554'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#767586'
  outline-variant: '#c7c4d7'
  surface-tint: '#494bd6'
  primary: '#4648d4'
  on-primary: '#ffffff'
  primary-container: '#6063ee'
  on-primary-container: '#fffbff'
  inverse-primary: '#c0c1ff'
  secondary: '#855300'
  on-secondary: '#ffffff'
  secondary-container: '#fea619'
  on-secondary-container: '#684000'
  tertiary: '#006c49'
  on-tertiary: '#ffffff'
  tertiary-container: '#00885d'
  on-tertiary-container: '#000703'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-margin: 1.25rem
  gutter: 1rem
  stack-sm: 0.5rem
  stack-md: 1rem
  stack-lg: 1.5rem
  section-gap: 2rem
---

## Brand & Style

This design system is built for the modern university student, balancing academic rigor with a friendly, approachable interface. The style is **Modern / Minimalist** with a focus on high legibility and soft tactile elements. It avoids the coldness of enterprise software by utilizing generous whitespace, rounded geometry, and a vibrant primary accent that feels energetic yet focused.

The emotional goal is "Productive Calm." By reducing visual noise and using soft transitions, the UI helps lower the cognitive load often associated with heavy course loads and deadlines. The aesthetic leans into high-quality typography and clear spatial relationships to organize complex academic schedules.

## Colors

The palette is centered around **Indigo (#6366F1)**, a color that represents both stability and intelligence. 

- **Primary:** Used for the main brand expression, FABs, active navigation states, and primary call-to-actions.
- **Priority System:** Uses a semantic traffic-light model but with adjusted saturations to remain "friendly." 
    - **High Priority:** #EF4444 (Soft Red)
    - **Medium Priority:** #F59E0B (Amber)
    - **Low Priority:** #10B981 (Emerald)
- **Neutral/Surface:** The background is a very cool off-white (#F8FAFC) to reduce glare during long study sessions, while the main content containers are pure white to provide maximum contrast.
- **State Colors:** Completed tasks should transition to a 40% opacity of the neutral slate color, accompanied by a subtle strikethrough. Overdue states use a muted rose tint background with soft red text to highlight urgency without causing panic.

## Typography

The design system utilizes **Inter** for its exceptional legibility and systematic feel. The hierarchy is strictly enforced to ensure students can scan their task lists quickly.

- **Headlines:** Use a Semi-Bold (600) or Bold (700) weight with tight letter spacing to create a grounded, authoritative feel for screen titles and subject names.
- **Body Text:** Standardized at 16px for primary reading and 14px for metadata (like notes or sub-tasks). 
- **Labels:** Used for chips, priority badges, and button text, utilizing a Medium (500) weight for clarity at small sizes.
- **Micro-copy:** Time-stamps and secondary metadata should use the `label-sm` style with a neutral slate color to recede in the visual hierarchy.

## Layout & Spacing

This design system follows a **8px spacing grid** to maintain consistency. The layout philosophy is mobile-first, utilizing a fluid grid with fixed safe-margin gutters.

- **Margins:** Mobile screens use a 20px (1.25rem) side margin to ensure content doesn't feel cramped.
- **Vertical Rhythm:** Elements within a card (like a title and its due date) use `stack-sm` (8px). Distinct sections or separate cards use `stack-lg` (24px) to provide visual breathing room.
- **Touch Targets:** All interactive elements must maintain a minimum height of 48px to ensure ease of use while walking between classes.

## Elevation & Depth

Hierarchy is established through a combination of **Tonal Layers** and **Ambient Shadows**. 

- **Level 0 (Background):** #F8FAFC. The canvas upon which all elements sit.
- **Level 1 (Cards/Surface):** Pure White (#FFFFFF) with a "Soft Ambient" shadow. The shadow uses a 12% opacity of the Indigo primary color rather than pure black, giving the UI a cohesive, "tinted" depth. 
- **Level 2 (Active/Hover):** When a card is interacted with, the shadow spread increases and the Y-offset drops slightly to simulate physical lift.
- **Overlays:** Modals and bottom sheets utilize a backdrop blur (12px) to maintain context of the underlying screen while focusing the user's attention.

## Shapes

The shape language is purposefully **Rounded (0.5rem base)** to evoke a friendly and modern personality.

- **Standard Components:** Input fields, checkboxes, and small buttons use a 8px (0.5rem) radius.
- **Container Elements:** Task cards and modal containers use `rounded-lg` (16px) or `rounded-xl` (24px) to create a distinct, friendly "bubble" feel that separates content from the background.
- **Pill Shapes:** Used exclusively for status badges (High/Medium/Low) and the Floating Action Button (FAB) to distinguish them as high-priority interactive or informational items.

## Components

### Buttons
- **Primary:** Indigo background, white text, pill-shaped for the FAB or 8px rounded for standard buttons. 
- **Secondary:** Transparent background with an Indigo border (2px) and Indigo text.

### Cards
- Task cards should feature a vertical "priority stripe" (4px wide) on the left edge corresponding to the priority color. 
- Use a 1px border (#E2E8F0) in addition to the soft shadow to maintain definition on high-brightness screens.

### Inputs
- Text inputs use a light grey border that turns Indigo on focus. 
- Labels sit above the field in `label-sm` style.

### Navigation
- **Bottom Bar:** Uses a blur effect with 90% opacity white. The active icon is tinted Indigo with a small 4px dot indicator underneath.
- **FAB:** A circular Indigo button with a white "plus" icon, positioned in the bottom-right or center-docked in the navigation bar.

### Progress Indicators
- Linear progress bars use a rounded track with 15% opacity of the primary color, with the filled portion using a vibrant Indigo gradient.

### Empty States
- Use soft, low-contrast illustrations with "Inter" body text centered. Avoid technical jargon; use encouraging phrases like "All clear for now—time for a coffee?"