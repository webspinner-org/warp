# Author

The authoring Spinner of the Warp build loop.

`authorSpinner({ slug, displayName, description, intent? }) →
{ ok, slug, scenarioSlug, bundlePath, skeinName, phase, witnessReport }`

Five phases: **scaffold → scenario-written → install → verify → report.**
The output is structured so the next layer (Mender, the Wizard, or any
consumer SI) reads it mechanically.

See `mission-lock.md` for the role contract, `how-it-works.md` for the
detailed flow.

## License

Apache 2.0. The name *Author* is trademark-pending of the Webspinner
Foundation; the implementation is open source.
