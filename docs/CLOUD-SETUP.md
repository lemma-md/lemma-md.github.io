# Connecting Google Drive

This is done once, by whoever publishes the app. Users of the app do not do any
of it — for them connecting is two clicks.

At the end you paste two values into `src/config.js`. Neither is a secret: both
are visible in the page source by design, and what actually protects them is
the origin and referrer restrictions set below.

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
  `https://<account>.github.io` that means verifying the domain in Google
  Search Console under the same account.
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
  - `https://<your-account>.github.io` for GitHub Pages
  - `http://localhost:8001` for local work

Origins have no path. `https://<account>.github.io` therefore covers every
project published under that account — see the origin discussion in
[ARCHITECTURE.md](ARCHITECTURE.md).

One client can hold as many origins as you like, so the published site and your
own machine share a single client ID and a single `src/config.js`. There is no
need for a separate development project.

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
one, so this app uses the PKCE token flow and never sends it. Nothing here
needs it, and publishing it would let someone else's site act as this app.

## 5. Create the API key

<https://console.cloud.google.com/apis/credentials> → *Create credentials* →
*API key*. Append `?project=<your-project-id>` to that link to skip the project
picker.

The key appears immediately, unrestricted. Restricting it is a second step:
close the dialog, then click the key's name in the list.

Set it up like this — and note that only one of the two restrictions applies:

- *API restrictions* → **Google Picker API**
- *Application restrictions* → **None**

**Do not add a website restriction.** It is the obvious thing to do and it
breaks the picker, with the misleading message *"The API developer key is
invalid"*. The reason is that the picker is a page served from
`docs.google.com` inside an iframe; the requests carrying the developer key
come from there, so their referrer is Google's, never this app's. A rule
listing `http://localhost:8001/*` rejects them. This was established the hard
way: everything else in the setup was verified correct first, and removing the
website restriction fixed it instantly.

That leaves the key readable by anyone, which is worth being clear-eyed about
rather than uneasy about:

- **The key is not a credential for data.** Every Drive call in this app is
  authorised by the user's OAuth token; a request bearing the key alone gets
  `401 CREDENTIALS_MISSING`. Restricting it to the Picker API keeps that true —
  the key cannot be pointed at anything else in the project.
- **The worst a thief can do is show a file picker** billed to this project's
  Picker quota. They still cannot see any Drive but their own.
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

1. **A website restriction on the key.** See step 5 — this is the one that cost
   an evening. The message is the same whether the key is wrong or merely
   refused, which is what makes it so misleading.
2. **The Google Picker API is not enabled** in the project. Enabling the Drive
   API is not enough, and the Picker API is easy to miss because searching the
   API Library for "Picker" surfaces the unrelated Photos Picker instead. Enable
   it at <https://console.cloud.google.com/apis/library/picker.googleapis.com>.

Before touching the console, it is worth establishing that the key itself is
sound. Any API that accepts a key will tell you, without needing OAuth:

```bash
KEY=AIza...
curl.exe -s "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"
curl.exe -s -H "Referer: http://localhost:8001/" "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"
curl.exe -s -H "Referer: http://evil.example/" "https://www.googleapis.com/books/v1/volumes?q=test&key=$KEY"
```

Read the JSON `reason`, which separates the possible faults cleanly:

| reason | meaning |
|---|---|
| `API_KEY_INVALID` | the key really is wrong |
| `API_KEY_HTTP_REFERRER_BLOCKED` | the website restriction rejects that referrer |
| `API_KEY_SERVICE_BLOCKED` | the key's *API restrictions* exclude that API |
| `SERVICE_DISABLED` | key and referrer are fine; the API is off in the project |

Beware that these checks run in a fixed order — referrer, then whether the API
is enabled in the project, then the key's API restrictions. An API that is off
in the project answers `SERVICE_DISABLED` and never reveals whether the key
would also have been blocked, so a key can look unrestricted when it is not.
Test against an API the project actually has enabled.

Two more things produce the same message from a key that is genuinely fine:

- **A new key, or a just-changed restriction, needs a few minutes.** Google says
  so in the error text of every disabled API. Testing within seconds of pressing
  *Create* is the commonest way to see this message once and never again.
- **The page may be running an older `config.js`.** `python -m http.server`
  sends no cache headers, so after filling in the credentials, reload with the
  cache bypassed. An empty `apiKey` reaches the picker as `developerKey=` with
  nothing after it, which it reports as an invalid key. To check, open the
  picker and look at the `iframe` whose source is `docs.google.com/picker`: the
  `developerKey` parameter must carry the key, and `appId` the project number.

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
