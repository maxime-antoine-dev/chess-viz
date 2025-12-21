from __future__ import annotations
from typing import Dict, Type
from .base import BaseBuilder

_REGISTRY: Dict[str, Type[BaseBuilder]] = {}

# Decorator to register builders by their .name
def register_builder(cls: Type[BaseBuilder]) -> Type[BaseBuilder]:
    name = getattr(cls, "name", None)
    if not name or not isinstance(name, str):
        raise ValueError(f"Builder class {cls.__name__} must define a string 'name' attribute.")
    if name in _REGISTRY:
        raise ValueError(f"Builder '{name}' already registered by {_REGISTRY[name].__name__}.")
    _REGISTRY[name] = cls
    return cls

def get_builder(name: str) -> Type[BaseBuilder]:
    if name not in _REGISTRY:
        known = ", ".join(sorted(_REGISTRY.keys()))
        raise KeyError(f"Unknown builder '{name}'. Known builders: {known}")
    return _REGISTRY[name]

def list_builders() -> list[str]:
    return sorted(_REGISTRY.keys())
