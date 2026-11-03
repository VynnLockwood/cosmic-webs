from pydantic import BaseModel, ConfigDict, Field


class Column(BaseModel):
    name: str
    type: str
    nullable: bool
    pk: bool


class Table(BaseModel):
    name: str
    columns: list[Column]
    row_estimate: int = 0


class FkEnd(BaseModel):
    table: str
    columns: list[str]


class Fk(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    from_: FkEnd = Field(alias="from")
    to: FkEnd


class SchemaGraph(BaseModel):
    tables: list[Table]
    fks: list[Fk]


class ParseResult(BaseModel):
    graph: SchemaGraph
    warnings: list[str]
