// GavinDS Chat Firebase configuration.
// Fill these values using Firebase Console > Project settings > Your apps.
// These browser config values are public; Firestore Security Rules are what protect your data.
// NEVER put a service-account/private key in this file.
export const firebaseConfig = {
  apiKey: "AIzaSyDxMBmz4ilPrqAj4gWg8mB5G2jO4Wpms_s",
  authDomain: "gavinds-72336.firebaseapp.com",
  projectId: "gavinds-72336",
  appId: "1:480907016103:web:326d81f9de83440c56a882"
};

export function isChatConfigured() {
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  return required.every((key) => {
    const value = String(firebaseConfig[key] || "");
    return value.length > 0 &&
      !value.includes("PASTE_") &&
      !value.includes("gavinds-72336") &&
      !value.includes("1:480907016103:web:326d81f9de83440c56a882");
  });
}
a
