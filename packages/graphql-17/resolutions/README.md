The initial resolution was recorded against upstream commit
`e35a025d6e947ed2db0c1378e130f2bd0438732c` using Git 2.54.0.

Upstream rewrote `OverlappingFieldsCanBeMergedRule` after v17.0.2. The resolution
preserves the new `FragmentDefinition` visitor, marks its `enter` method
schedulable, and retains the scheduling marker on `SelectionSet`.

These records are replayed from the v17.0.0 starting patch. Changes to that patch
may change the conflict shape and require recording another resolution.
