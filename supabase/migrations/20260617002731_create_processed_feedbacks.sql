-- SPDX-FileCopyrightText: Copyright (C) 2026 Aresta Climb Contributors
-- SPDX-License-Identifier: MPL-2.0

CREATE TABLE processed_feedbacks (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
