# Map animation – two-browser cloud conflict test (Firefox + Chrome, one computer)

You do **not** need two physical computers. Two different browsers on one computer have separate storage and
sessions, so each behaves like its own computer. Use a **disposable** show – never one of your real shows.

The automated version (two isolated browser processes against the fake cloud and against real SQL) is
`tests/browser/map_animation_two_browser_conflict_check.py`; this page is the manual run for Firefox + Chrome.

1. **Chrome (A):** open WX Studio, sign in. File ▸ New show, name it **ZZ ANIM CONFLICT TEST**. Add a map scene, place a
   front and a text label, press **🎞 Animate**, add **Step 2** and **Step 3** (move the front a little in each). Wait for **Saved to cloud**.
2. **Firefox (B):** open WX Studio, sign in with the same account, open **ZZ ANIM CONFLICT TEST** (My Shows). Check it has 3 steps.
3. **Chrome (A):** select **Step 2**, move a point and rename the step to *A step two*. Wait for **Saved to cloud**.
4. **Firefox (B) – do not reload:** select **Step 3**, change the text and rename the step to *B step three*.
5. Firefox must show the **"This show was changed on another computer"** dialog. Choose **Keep both**.
6. Open **My Shows** in either browser. You must see **two** shows: the original and a copy with a different name.
   * Original: Step 2 = *A step two* (moved), Step 3 = unchanged.
   * Copy: Step 3 = *B step three*, Step 2 = unchanged.
   * Both play all 3 steps with the same durations as you set; neither lost a step or an object.
7. Delete both test shows when finished.

Pass = the dialog appeared, nothing was overwritten silently, and both versions are complete.
