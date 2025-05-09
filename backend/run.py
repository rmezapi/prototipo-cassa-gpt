import uvicorn
import argparse

# Default port set back to 8000
default_port = 8000

if __name__ == "__main__":
    # Add command line argument parsing
    parser = argparse.ArgumentParser(description="Run the backend server")
    parser.add_argument("--port", type=int, default=default_port, help=f"Port to run the server on (default: {default_port})")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to run the server on (default: 0.0.0.0)")
    args = parser.parse_args()

    print(f"Starting server on {args.host}:{args.port}")
    uvicorn.run("main:app", host=args.host, port=args.port, reload=True)
