import { createBrowserRouter } from "react-router";
import MainLayout from "./layouts/MainLayout.tsx";
import Chat from "./pages/Chat.tsx";
import KnowledgeGraph from "./pages/KnowledgeGraph.tsx";
import Documents from "./pages/Documents.tsx";
import Evaluations from "./pages/Evaluations.tsx";
import Settings from "./pages/Settings.tsx";
import Login from "./pages/auth/Login.tsx";
import Register from "./pages/auth/Register.tsx";
import Plan from "./pages/auth/Plan.tsx";
import ForgotPassword from "./pages/auth/ForgotPassword.tsx";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: MainLayout,
    children: [
      { index: true, Component: Chat },
      { path: "graph", Component: KnowledgeGraph },
      { path: "documents", Component: Documents },
      { path: "evaluations", Component: Evaluations },
      { path: "settings", Component: Settings },
    ],
  },
  { path: "/auth/login",           Component: Login          },
  { path: "/auth/register",        Component: Register       },
  { path: "/auth/register/plan",   Component: Plan           },
  { path: "/auth/forgot-password", Component: ForgotPassword },
]);