import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The .env file lives in backend/src/.env while this module is in backend/src/lib/.
// Load it by absolute path so the app works regardless of the current working directory.
dotenv.config({ path: path.join(__dirname, "..", ".env") });
