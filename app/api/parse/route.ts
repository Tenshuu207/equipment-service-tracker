import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      error: "UI upload parsing is disabled for now. Use the Python importer/backend path."
    },
    { status: 501 }
  )
}
