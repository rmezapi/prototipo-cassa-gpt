import asyncio
from services.document_processor_service import doc_processor_service

async def main():
    # Replace with path to your test file
    file_path = """backend\test_docs\CV César Guerra 1.pdf""" # type: ignore # or .docx, .xlsx, .jpg
    filename = file_path.split('/')[-1]

    try:
        with open(file_path, 'rb') as f:
            file_bytes = f.read()

        print(f"Processing {filename}...")
        chunks = await doc_processor_service.process_document(file_bytes, filename)

        if chunks:
            print(f"\n--- Generated {len(chunks)} Chunks ---")
            for i, chunk in enumerate(chunks):
                print(f"\n--- Chunk {i+1} ---")
                print(chunk)
        else:
            print("No chunks generated (file unsupported or empty?).")

    except FileNotFoundError:
        print(f"Error: Test file not found at {file_path}")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    asyncio.run(main())
# ```*   Run it: `python test_processor.py`