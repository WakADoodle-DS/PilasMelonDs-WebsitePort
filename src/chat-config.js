// GavinDS Chat Firebase configuration.
// Fill these values using Firebase Console > Project settings > Your apps.
// These browser config values are public; Firestore Security Rules are what protect your data.
// NEVER put a service-account/private key in this file.
export const firebaseConfig = {
  apiKey: "PASTE_FIREBASE_WEB_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_FIREBASE_WEB_APP_ID"
};

export function isChatConfigured() {
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => {
    const value = String(firebaseConfig[key] || "");
    return value.length > 0 &&
      !value.includes("PASTE_") &&
      !value.includes("YOUR_PROJECT_ID") &&
      !value.includes("YOUR_FIREBASE_WEB_APP_ID");
  });
}
