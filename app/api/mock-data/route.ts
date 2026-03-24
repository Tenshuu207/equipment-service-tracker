/**
 * Mock data for dashboard preview.
 * In production, these are served by the FastAPI backend (scripts/dashboard/api.py)
 * running on localhost:8000.
 *
 * Replace API_BASE_URL in lib/api.ts to point at FastAPI when running locally.
 */

import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({ message: "Use the FastAPI backend at localhost:8000 for live data." })
}
