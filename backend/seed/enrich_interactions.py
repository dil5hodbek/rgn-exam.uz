import asyncio

from app.importer.roadmap_import import enrich_interactions


if __name__ == "__main__":
    print(asyncio.run(enrich_interactions()))
