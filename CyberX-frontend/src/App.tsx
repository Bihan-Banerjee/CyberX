// src/App.tsx
import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes/app-router';

export default function App() {
  return <RouterProvider router={router} />;
}
