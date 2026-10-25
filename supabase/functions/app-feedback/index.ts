// SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
// SPDX-License-Identifier: MPL-2.0

import "@supabase/functions-js/edge-runtime.d.ts";
import { handleRequest } from "./handler.ts";

Deno.serve(handleRequest);
