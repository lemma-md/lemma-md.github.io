# Connecting Google Drive

This is done once, by whoever publishes the app. Users of the app do not do any
of it — for them connecting is two clicks.

At the end you paste three values into `src/config.js`. None is a secret: all
are visible in the page source by design, so what keeps them safe is not
concealment but the restrictions set on them. The OAuth client is guarded by
its authorised origins, and it is the only thing standing between a stranger
and a user's Drive. The API key merely identifies the Cloud project for quota
accounting; keep it limited to the Picker API, and note that its referrer list
must include Google's own domains, because the picker calls home from inside a
Google iframe.

## 1. Create a project

In the [Google Cloud Console](https://console.cloud.google.com), create a
project (any name).

Note the **project number** shown on the dashboard — a long integer, not the
project ID. It is needed in step 6.

If you miss it, you already have it: the project number is the run of digits
before the dash in the OAuth client ID from step 4. A client id of
`56804105563-ku0c9….apps.googleusercontent.com` belongs to project number
`56804105563`.

## 2. Enable the two APIs

- **Google Drive API** — reading and writing file contents:
  <https://console.cloud.google.com/apis/library/drive.googleapis.com>
- **Google Picker API** — the file chooser the user sees:
  <https://console.cloud.google.com/apis/library/picker.googleapis.com>

Use the links. Searching the API Library for "Picker" tends not to surface it,
and the Photos Picker API — a different product — comes up instead.

## 3. Configure the consent screen

Under *APIs & Services → OAuth consent screen*:

- User type: **External**
- Fill in app name, support email and developer email
- Upload `logo-120.png` from the repository root as the app logo — Google
  requires a square PNG of exactly 120×120 px, which is why that file exists
- Add exactly one scope: `https://www.googleapis.com/auth/drive.file`

**Do not add any other scope.** `drive.file` is classified as *non-sensitive*,
and that is what keeps this simple: apps requesting only non-sensitive scopes
are not put through Google's *scope* review. Adding a broader Drive scope turns
on the "Google hasn't verified this app" warning and requires that review —
which for this audience would end the experiment.

### Start in Testing, publish before anyone else arrives

Leave the publishing status at its default, **Testing**, while the cloud
support is being built. Add your own address under *Test users* and everything
works at once: no verification, nothing to prove to Google, no waiting.

**Testing is a workbench, not a destination.** Three things make it unfit for
real users, and the first is the one that matters:

- Test users are shown the **"Google hasn't verified this app"** screen and
  have to click *Advanced* and then past a warning that calls the app unsafe.
  This applies in Testing whatever the scopes are — choosing a non-sensitive
  scope does not buy an exemption here, it only exempts you from the review.
- A test user's authorisation **expires seven days after consent**, so they
  would have to walk through that screen again every week. (Apps asking only
  for name and email are excluded from this; `drive.file` is not.)
- Test users are added one email at a time in the console, up to 100.

For a colleague who does not yet believe markdown is worth their time, a screen
warning that the app is unsafe is the end of the conversation. So switch to
*In production* before showing it to anyone — but there is no reason to do it
earlier.

### What publishing then triggers

Scope review is not the only review. An app that is *External* **and**
*Published* goes through **brand verification** if its consent screen shows a
display name or a logo — so this one does, logo or not, because it has a name.
Brand verification is the lighter of the two: it checks that the app name,
logo, home page and authorised domains agree with each other and that you own
the domain. Google's automated check usually finishes in minutes; a case that
needs a human takes two to three business days.

Two practical consequences:

- Be ready to prove ownership of the origin the app is served from. For
  `https://lemma-md.github.io/` that means adding it in Google Search Console
  as a *URL-prefix* property — signed in as the same Google account that owns
  this Cloud project — and verifying by uploading the HTML file it offers to
  the repository root. (`github.io` is on the Public Suffix List, so each
  subdomain is its own site; verifying the parent is neither possible nor
  needed.)
- Later edits to the app name, the logo or the URLs create a new draft that
  can be sent back through the check, so treat them as deliberate changes
  rather than tweaks.

Sources: [when verification is not needed](https://support.google.com/cloud/answer/13464323),
[app audience](https://support.google.com/cloud/answer/15549945),
[brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification),
[OAuth app verification](https://support.google.com/cloud/answer/13463073).

## 4. Create the OAuth client ID

*APIs & Services → Credentials → Create credentials → OAuth client ID*

- Application type: **Web application**
- **Authorised JavaScript origins** — add each origin the app is served from:
  - `https://lemma-md.github.io` for GitHub Pages
  - `http://localhost:8001` for local work

Origins carry no path, which is why the app is published from an organisation
of its own rather than as one project among many under a personal account —
see the origin discussion in [ARCHITECTURE.md](ARCHITECTURE.md).

One client can hold as many origins as you like, so a small private deployment
can let the published site and local development share a single client ID and
`src/config.js`.

For a public deployment, separate development and production Cloud projects
are safer. `localhost` identifies an origin, not your particular computer:
anyone can run a page on their own `localhost:8001` and reuse a public browser
client ID with their own Google account. Separate projects keep development
traffic and quota exhaustion from affecting production. This requires using
the development project's values locally and the production values in the
deployed copy of `src/config.js`.

Three ways this goes wrong locally:

- **The port is part of the origin and is matched exactly.** `http://localhost:8001`
  does not authorise `http://localhost:8080`. Serve the app on the one port you
  registered — the `python -m http.server 8001` in [README.md](../README.md) —
  or register each port you actually use.
- **`localhost` and `127.0.0.1` are different origins.** `python -m http.server`
  advertises `0.0.0.0`, and following that link lands you on `127.0.0.1`.
  Register whichever one is in the address bar, or simply always type
  `localhost`.
- **Plain `http` is refused everywhere except localhost.** That exemption is
  what makes local work possible at all; a LAN address such as
  `http://192.168.1.5:8001` is not covered by it.

Copy the client ID.

The console also offers a `client_secret_….json` download. **Take only the
client id out of it and keep the file out of the repository** — it is already
in `.gitignore`. Despite the name, that file is not the API key of step 5, and
the `client_secret` inside it is a genuine secret: it belongs to the
authorisation-code flow that servers use. A browser app has nowhere to hide
one, so this app uses Google's browser token flow and never sends it. Nothing
here needs it, and publishing it would let someone else's site act as this app.

## 5. Create the API key

<https://console.cloud.google.com/apis/credentials> → *Create credentials* →
*API key*. Append `?project=<your-project-id>` to that link to skip the project
picker.

The key appears immediately, unrestricted. Restricting it is a second step:
close the dialog, then click the key's name in the list.

Set both restrictions. This exact pair is what the app runs on:

- *API restrictions* → **Google Picker API**, and nothing else
- *Application restrictions* → **Websites**, with all four of:
  - `https://lemma-md.github.io/*`
  - `http://localhost:8001/*`
  - `*.google.com`
  - `*.googleusercontent.com`

**The two Google wildcards are the part nobody guesses, and leaving them out is
what breaks the picker** — with the thoroughly misleading message *"The API
developer key is invalid"*. The picker is served from `docs.google.com` inside
an iframe, and the internal requests carrying the key have a Google referrer,
not this app's. A rule naming only `localhost` and the production site rejects
them. Google's own
[Apps Script Picker instructions](https://developers.google.com/apps-script/guides/dialogs#file-open_dialogs)
prescribe the same two wildcards.

Two ways to confirm the rule is doing its job, both worth running once:

- The picker opens a file. That is the only test that exercises Google's
  internal referrer.
- `curl.exe -s -H "Referer: http://evil.example/" "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"`
  answers `API_KEY_HTTP_REFERRER_BLOCKED`, proving the restriction is live
  rather than merely saved.

Should a future Google change break this, *Application restrictions* → **None**
is the compatible fallback; keep the API restriction either way, since that is
the one carrying the security weight. `PickerBuilder.setOrigin()` is not a
remedy — it configures communication with the iframe, not the HTTP referrer the
key is validated against.

**Do not add the Drive API to the key.** It looks reasonable, since the picker
shows Drive files, and it is wrong: every Drive call in this app is authorised
by the user's OAuth token, never by the key. Granting it buys nothing and opens
the one genuine abuse route, described next.

That leaves the key readable by anyone, which is worth being clear-eyed about
rather than uneasy about:

- **The key is not a credential for data.** Every Drive call in this app is
  authorised by the user's OAuth token; a request bearing the key alone gets
  `401 CREDENTIALS_MISSING`. Restricting it to the Picker API keeps that true —
  the key cannot be pointed at anything else in the project.
- **Starving the quota is not available to a thief either — as long as the key
  stays Picker-only.** The two APIs differ in exactly the way that matters.
  Picker is capped at **60 queries per minute per user**: a ceiling on each
  account separately, so a stranger burns their own allowance and leaves
  everyone else untouched. Drive is capped **per project** — 12,000 requests
  per minute shared by everybody — which is a pool a stranger *could* drain,
  denying your users their own notes. That is the whole reason the Drive API
  must stay off this key. Check the *Quotas & System Limits* page again if
  Google ever gives Picker a project-wide rate, since that is the assumption
  this rests on.
- **The website restriction is compatibility filtering, not proof of origin.**
  It stops an unrelated site from using the key, which is worth having. It
  cannot prove a request came from this app, because another picker instance
  runs inside Google's iframe too and carries the very same Google referrers.
- **What actually guards the data** is the OAuth client: its authorised
  JavaScript origins, which *are* enforced, plus the `drive.file` scope. That is
  where to be strict — see step 4.

Copy the key.

## 6. Fill in the config

```js
// src/config.js
export const GOOGLE = {
  clientId: '....apps.googleusercontent.com',
  apiKey: '....',
  appId: '123456789012',   // the project *number* from step 1
}
```

The app id is what makes a file the user picks reachable under `drive.file`.
Leave it out and the chooser works, but reading the chosen file fails
afterwards — a confusing failure worth avoiding.

Reload the app. *Open from cloud* and *Save to cloud* appear in the toolbar,
and Settings offers a Connect button.

## What the user sees

1. They press **Connect** (or *Open from cloud*, which connects first).
2. Google's own account chooser appears — usually they are already signed in.
3. One consent screen: *"…wants to see, edit, create and delete only the
   specific Google Drive files you use with this app"*. No warnings.
4. Afterwards, *Open from cloud* shows Google's own file picker.

Access lasts about an hour and is renewed silently while their Google session
is alive, so in practice they consent once.

## When the picker says "The API developer key is invalid"

It almost never means the key is mistyped. In order of likelihood:

1. **The website restriction is missing `*.google.com` and
   `*.googleusercontent.com`.** A rule listing only this app's own URLs rejects
   the picker's internal iframe request, which carries a Google referrer. See
   step 5. The message reads the same whether the key is wrong or merely
   refused, which is what makes it so misleading — and why this cost an evening
   here, with three wrong theories tried before the right one.
2. **The Google Picker API is not enabled** in the project. Enabling the Drive
   API is not enough, and the Picker API is easy to miss because searching the
   API Library for "Picker" surfaces the unrelated Photos Picker instead. Enable
   it at <https://console.cloud.google.com/apis/library/picker.googleapis.com>.
3. **The page may be running an older `config.js`.** `python -m http.server`
   sends no cache headers, so after filling in the credentials, reload with the
   cache bypassed. An empty `apiKey` reaches the picker as `developerKey=` with
   nothing after it, which it reports as an invalid key. To check, open the
   picker and look at the `iframe` whose source is `docs.google.com/picker`: the
   `developerKey` parameter must carry the key, and `appId` the project number.
4. **A new key or restriction has not propagated yet.** Wait several minutes
   after creating the key or changing its restrictions before diagnosing a
   second problem.

### Interrogating the key directly

The picker itself is a poor witness: it reports every one of the causes above
with the same sentence. The key will answer more precisely, and without needing
OAuth. The Picker API has no REST surface to call, so aim at any other API and
read the failure rather than the success — `books` below is only a target to
provoke an answer:

```bash
KEY=AIza...
curl.exe -s "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"
curl.exe -s -H "Referer: http://localhost:8001/" "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"
curl.exe -s -H "Referer: http://evil.example/" "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"
```

The JSON carries a `reason` that separates the faults:

| reason | meaning |
|---|---|
| `API_KEY_INVALID` | the key really is wrong |
| `API_KEY_HTTP_REFERRER_BLOCKED` | a website restriction rejected that referrer |
| `API_KEY_SERVICE_BLOCKED` | the key's *API restrictions* exclude that API |
| `SERVICE_DISABLED` | key and referrer passed; that API is off in the project |

**Read these in light of the order the checks run in:** referrer first, then
whether the API is enabled in the project, then the key's API restrictions.
Two consequences, both of which have already misled a diagnosis here:

- A referrer verdict is trustworthy whatever else is wrong, because it comes
  first. This is what makes the third command above meaningful even for a key
  correctly limited to the Picker API — `API_KEY_HTTP_REFERRER_BLOCKED` for a
  foreign referrer proves a website restriction is live and enforced.
- `SERVICE_DISABLED` is the end of the road, not a clean bill of health. It
  means the request never reached the API-restriction check, so a key that
  looks unrestricted may not be. To learn about restrictions, aim at an API the
  project actually has enabled. `drive.googleapis.com` serves well: it answers
  `API_KEY_SERVICE_BLOCKED` when the key may not use it, and a plain Drive
  permission error such as `insufficientFilePermissions` when it may — that
  second answer means the key passed every key-level check and only then ran
  out of authorisation, since Drive needs the user's token rather than a key.

Note that the cloud buttons appear only when all three values are present, so
if you could click *Open from cloud* at all, `config.js` was at least fully
populated when the page loaded.

## Notes

- The token is held in memory only, never written to storage. Other pages on
  the same origin cannot read it, and closing the tab ends the session.
- Google's libraries are loaded from Google's servers the moment someone
  connects — they cannot be vendored. Nobody who ignores the cloud ever loads
  them.
- `drive.file` means this app can never see anything in a Drive except the
  files the user picked or the app itself created. That is a property of the
  scope, not a promise made by this code.
