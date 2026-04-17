import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAfTvWF9HovGnbMbLV0K3FRc5KFDsE6A2I",
  authDomain: "ezra-fm.firebaseapp.com",
  projectId: "ezra-fm",
  storageBucket: "ezra-fm.firebasestorage.app",
  messagingSenderId: "842164336044",
  appId: "1:842164336044:web:41669b0225d8967bad7609"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);