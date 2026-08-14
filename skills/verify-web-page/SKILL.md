# verify-web-page

Verify that a web page is reachable and contains expected content.

## When to use

Use this skill when the user asks you to:

- check whether a website or URL is live
- verify that a page contains specific text
- confirm a deployment or page is serving expected content
- compare text on a page against an expected value

## Steps

1. **Fetch the page** with `http.fetch` (GET) against the target URL.
   - If the fetch fails or returns a non-2xx status, stop and report the status.
2. **Extract visible text** with `browser.text` (no selector reads the whole body).
   - If no browser session exists yet, create one with `browser.session.create` and navigate with `browser.navigate` first.
3. **Check expected content**: search the visible text (case-insensitive) for the expected phrase the user provided.
4. **Report**:

   - reachable: true/false (HTTP status)
   - expected text found: true/false
   - title: the page title
   - a one-line summary

## Notes

- If the page requires a login, stop and tell the user instead of guessing.
- Do not modify anything on the page; this skill is read-only verification.
