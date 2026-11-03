# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students learning Chinese through HSK courses; teachers who assign lessons and monitor student progress; and administrators who manage courses and accounts.

## Product Purpose

TIẾNG TRUNG DƯƠNG HỮU provides a Vietnamese-language learning website for studying Chinese through structured HSK lessons. Success means helping students learn and practise Chinese while giving teachers and administrators the tools to support that learning.

## Positioning

The website combines HSK course lessons, vocabulary, grammar, listening, practice, and progress workflows in one role-based learning environment.

## Operating Context

Students use the authenticated learning area to study courses and practise lesson material. Teachers review class and course progress. Administrators manage learning content and user access.

## Capabilities and Constraints

- The existing application is a React Router web app with authenticated admin, teacher, and student roles.
- New learning experiences should use the existing authentication and course data where applicable, without disrupting other study workflows.
- HSK 3.0 data must remain distinct from HSK 2.0 data. If a level has no verified source data, the interface must report that data is unavailable rather than substitute or invent vocabulary.
- The requested handwriting interaction uses HanziWriter stroke-order recognition on-device, not image matching. It validates strokes against character stroke data and may reject writing that does not follow the expected stroke order.
- Students need to use the experience on desktop, tablet, and phone, including touch input.
- Chinese pronunciation should use available vocabulary audio first and an appropriate Chinese TTS fallback when needed.
- HSK 7–9 is a distinct level group, not a relabelled HSK 6 dataset.

## Brand Commitments

The existing learning website is named TIẾNG TRUNG DƯƠNG HỮU. The requested game is named “THẦN BÚT – TIẾNG TRUNG DƯƠNG HỮU”. The game may use an original classical-Chinese-inspired setting; it must not copy Hanzii characters, imagery, or assets.

## Evidence on Hand

- Existing HSK 3.0 lesson vocabulary files are present for HSK 1–3 under `courses/hsk1_3-0/`, `courses/hsk2_3-0/`, and `courses/hsk3_3-0/`.
- The repository also contains HSK 2.0 test data and must not treat it as HSK 3.0.
- No verified HSK 6 or HSK 7–9 vocabulary source was identified in the project inventory.
- The application already depends on `hanzi-writer` and has Chinese speech/audio utilities.
- The website uses Prisma with PostgreSQL and has existing student, teacher, and administrator accounts and learning-progress workflows.

## Product Principles

- Use verified learning content and preserve its level and lesson provenance.
- Make practice useful and honest: distinguish genuine recognition, pronunciation, progress, and unavailable capabilities.
- Fit new learning activities into existing account roles and study workflows.
- Keep core practice usable with touch, pointer, and keyboard-accessible controls.
- Prefer existing learning content and platform services over duplicated or fabricated data.

## Accessibility & Inclusion

- Support desktop, tablet, and phone layouts.
- Support touch, mouse, and stylus input for handwriting practice.
- Keep text legible and controls operable across viewport sizes.
