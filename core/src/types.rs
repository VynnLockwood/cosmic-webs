use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Column {
    pub name: String,
    pub r#type: String,
    pub nullable: bool,
    pub pk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub row_estimate: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FkEnd {
    pub table: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Fk {
    pub id: String,
    pub from: FkEnd,
    pub to: FkEnd,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct SchemaGraph {
    pub tables: Vec<Table>,
    pub fks: Vec<Fk>,
}

impl SchemaGraph {
    pub fn table_index(&self, name: &str) -> Option<usize> {
        self.tables.iter().position(|t| t.name == name)
    }
}
