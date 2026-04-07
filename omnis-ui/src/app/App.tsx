import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./components/ThemeProvider";
import { UploadProvider } from "./context/UploadContext";

export default function App() {
  return (
    <ThemeProvider>
      <UploadProvider>
        <RouterProvider router={router} />
      </UploadProvider>
    </ThemeProvider>
  );
}