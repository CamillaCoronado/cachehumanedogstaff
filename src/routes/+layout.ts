// Every page loads its data in the browser from Firestore, so a server render only
// ever produced the loading screen. Rendering client-side lets the service worker
// serve one cached shell for every route, with no trip to the server on a weak signal.
export const ssr = false;
