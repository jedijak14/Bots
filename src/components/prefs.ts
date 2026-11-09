"use client";
import { createContext, useContext } from "react";

export type Prefs = { followMouse: boolean; animations: boolean };

export const PrefsContext = createContext<Prefs>({ followMouse: true, animations: true });

export const usePrefs = () => useContext(PrefsContext);
