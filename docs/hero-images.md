# Hero Images contract

`data/hero-images.json` is core-owned. Every entry binds a hero composition to `animalId`, `slug` and original `fileId`; animal name, age and location are deliberately resolved from the live animal record.

Each doodle has a normalized transform: `x` and `y` are the centre point in the source image (`0..1`), `scale` is a fraction of the displayed image width, and `rotation` is degrees around its centre. Render the image and doodles in one same-aspect-ratio scene before `object-fit: cover`; then crop the scene. This keeps the composition stable for cover layouts.
