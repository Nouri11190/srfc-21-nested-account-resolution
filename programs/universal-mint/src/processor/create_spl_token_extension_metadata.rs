use crate::state::metadata_info::MetadataInfo;
use anchor_lang::prelude::*;

use anchor_lang::solana_program::system_instruction;
use anchor_spl::{
    associated_token::AssociatedToken, token_2022::mint_to,
    token_2022::spl_token_2022::extension::metadata_pointer, token_interface::Token2022,
};
use anchor_spl::{
    associated_token::{self, get_associated_token_address},
    token_2022::MintTo,
    token_interface::spl_token_2022::extension::ExtensionType,
};

#[derive(Accounts)]
#[instruction(name: String, description: String)]
pub struct CreateSplToken22Metadata<'info> {
    #[account(mut)]
    payer: Signer<'info>,
    #[account(mut)]
    mint: Signer<'info>,
    /// CHECK:
    #[account(mut)]
    ata: UncheckedAccount<'info>,
    /// CHECK:
    #[account(init, space = 8 + 4 + name.len() + 4 + description.len(), payer=payer, seeds=[&mint.key.to_bytes(), "token22".as_bytes(), &"metadata_pointer".as_bytes()], bump)]
    metadata_pointer: Account<'info, MetadataInfo>,
    token_program: Program<'info, Token2022>,
    associated_token_program: Program<'info, AssociatedToken>,
    system_program: Program<'info, System>,
}

pub fn create_spl_token_extension_metadata(
    ctx: Context<CreateSplToken22Metadata>,
    name: String,
    description: String,
) -> Result<()> {
    let payer = &ctx.accounts.payer;
    let mint = &ctx.accounts.mint;
    let ata = &ctx.accounts.ata;
    let associated_token_program = &ctx.accounts.associated_token_program;
    let token_program = &ctx.accounts.token_program;
    let system_program = &ctx.accounts.system_program;

    // Write to the metadata pointer
    let metadata_pointer = &mut ctx.accounts.metadata_pointer;
    metadata_pointer.name = name.clone();
    metadata_pointer.description = description.clone();

    let size = ExtensionType::try_calculate_account_len::<
        anchor_spl::token_2022::spl_token_2022::state::Mint,
    >(&[ExtensionType::MetadataPointer])?;
    msg!("Found size: {}", size);
    let extension_len: usize = 234;
    anchor_lang::solana_program::program::invoke(
        &system_instruction::create_account(
            payer.key,
            &mint.key(),
            Rent::get()?.minimum_balance(extension_len),
            extension_len as u64,
            token_program.key,
        ),
        &[payer.to_account_info(), mint.to_account_info()],
    )?;

    // Initialize the metadata extension in the mint
    let bump = ctx.bumps.metadata_pointer;
    anchor_lang::solana_program::program::invoke_signed(
        &metadata_pointer::instruction::initialize(
            token_program.key,
            mint.key,
            Some(payer.key()),
            Some(metadata_pointer.key()),
        )?,
        &[mint.to_account_info()],
        &[&[
            &mint.key.to_bytes(),
            "token22".as_bytes(),
            "metadata_pointer".as_bytes(),
            &[bump],
        ]],
    )?;

    // Initialize the mint
    anchor_spl::token_interface::initialize_mint2(
        CpiContext::new(
            token_program.to_account_info(),
            anchor_spl::token_interface::InitializeMint2 {
                mint: mint.to_account_info(),
            },
        ),
        0,
        payer.key,
        Some(payer.key),
    )?;

    // create ATA for the user
    msg!("Writing to ATA");
    associated_token::create(CpiContext::new(
        associated_token_program.to_account_info(),
        {
            associated_token::Create {
                payer: payer.to_account_info(),
                associated_token: ata.to_account_info(),
                mint: mint.to_account_info(),
                authority: payer.to_account_info(),
                system_program: system_program.to_account_info(),
                token_program: token_program.to_account_info(),
            }
        },
    ))?;

    // mint to the payer's wallet
    msg!("Minting to user's wallet");
    mint_to(
        CpiContext::new(
            token_program.to_account_info(),
            MintTo {
                mint: mint.to_account_info(),
                to: ata.to_account_info(),
                authority: payer.to_account_info(),
            },
        ),
        1,
    )?;

    Ok(())
}
