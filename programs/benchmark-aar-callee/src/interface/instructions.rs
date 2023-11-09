use anchor_lang::prelude::*;

// This is what we need to use the transfer linked list thing
#[derive(Accounts)]
pub struct ITransfer<'info> {
    /// CHECK:
    pub owner: AccountInfo<'info>,
    /// CHECK:
    pub head_node: AccountInfo<'info>,
}
