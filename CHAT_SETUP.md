# Setting up GavinDS Chat

GavinDS is hosted on GitHub Pages, which serves static files. The chat panel therefore uses Firebase Authentication and Cloud Firestore for temporary guest sessions and live message updates. The panel UI can load without Firebase, but creating/joining rooms will not work until you complete this setup.

## 1. Create the Firebase project

1. Open the [Firebase Console](https://console.firebase.google.com/) and create a project for GavinDS.
2. In Project settings, add a **Web app** and copy its configuration object.
3. In Authentication, open **Sign-in method** and enable **Anonymous** sign-in.
4. In Firestore Database, create a database. Start with locked/production rules; do not enable unrestricted test rules.

Firebase anonymous authentication gives each browser a technical guest ID. Users still choose a temporary display name for each room; no email address or permanent in-app username is requested by GavinDS.

## 2. Add the web configuration

Edit `src/chat-config.js` and replace the placeholder values with the config values for your Firebase web app. For example, copy the values for `apiKey`, `authDomain`, `projectId`, and `appId`.

Firebase's web-app config is client-side configuration, not a service-account secret. **Never add a service-account JSON file or private server key to this repository.** The database rules below are what limit what browsers can do.

## 3. Install the Firestore security rules

In Firebase Console, open Firestore Database → Rules and replace the rules with the contents of `firestore.rules`, then publish them.

The rules are designed to:
- Require a Firebase-anonymous guest session.
- Allow joining by direct six-character room code, without a public room directory.
- Require the host to provide a temporary name when creating the room.
- Limit rooms to 12 members and names to 20 characters.
- Allow members to change only their own membership/name.
- Limit messages to 400 characters and prevent clients from editing existing messages.
- Expire rooms and messages after 24 hours at the app/rules level.

## 4. Allow GitHub Pages to sign in

In Firebase Authentication → Settings → Authorized domains, add the domain serving your GitHub Pages site (for this repository, it will normally be `wakad oodle-ds.github.io` without a path; use the exact origin shown in your browser). Do not include `/PilasMelonDs-WebsitePort/` or any other URL path.

## 5. Turn on automatic data cleanup

Firestore's time-to-live (TTL) cleanup runs asynchronously; setting an `expiresAt` field by itself does not physically erase records from the database.

In Firestore's TTL settings, configure an `expiresAt` policy for the `gavindsChatRooms` collection and an `expiresAt` policy for the `messages` collection group. This lets Firestore clean up expired room documents and message documents. Until TTL cleanup removes them, expired records may remain stored even though the app and rules treat them as expired.

## 6. Test before sharing

1. Push the branch and deploy a test copy or preview.
2. Open the site in two separate browsers/devices.
3. In the first, enter a temporary username and create a room.
4. Share the six-character code with the second browser. Enter a different temporary username and join.
5. Verify that messages arrive live, unknown codes fail, the room stops accepting messages after expiry, and the host can close it.

Keep testing to people you trust before sharing the room feature more widely. A room is not publicly listed, but anyone with its code can enter. Temporary usernames do not make messages private from room members or from the service/database administrator. Do not share real names, school details, contact information, passwords, or other personal information. These first-pass features do not include automated moderation, message reports, or robust anti-spam controls; those should be added before a large public launch.

## Hosting/usage note

Firebase usage limits and pricing can change. Review the current Firebase plan and usage dashboard before inviting many people, and do not enable a paid plan or billing without an adult's help and approval.
