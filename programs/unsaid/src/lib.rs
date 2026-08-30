//! UNSAID ownership layer.
//!
//! This program stores proof that a specific encrypted memory existed, that a
//! specific key owns it, and when that was established. It stores nothing else.
//!
//! Blueprint §14.3 — what must never appear in this file: plaintext thoughts,
//! transcripts, audio, email addresses, phone numbers, or encryption keys. A
//! Solana account is public and permanent; treat every byte written here as
//! published forever.
//!
//! The `commitment` is a SHA-256 over the thought id and the *ciphertext* hash.
//! It proves a particular encrypted object existed at a point in time without
//! revealing anything about what it says.

use anchor_lang::prelude::*;

declare_id!("8YKzd762j9R8Mn6u8sxsTtHcif3uqdvKCyKnLZP3oATA");

#[program]
pub mod unsaid {
    use super::*;

    /// Anchors one memory. The PDA is derived from the owner and thought id, so
    /// a repeated submission of the same anchor hits the same address and fails
    /// as already-initialised rather than creating a duplicate record (D-03).
    pub fn create_record(
        ctx: Context<CreateRecord>,
        thought_id: [u8; 32],
        commitment: [u8; 32],
        access_mode: u8,
    ) -> Result<()> {
        require!(commitment != [0u8; 32], UnsaidError::EmptyCommitment);
        require!(access_mode <= AccessMode::MAX, UnsaidError::InvalidAccessMode);

        let record = &mut ctx.accounts.record;
        record.owner = ctx.accounts.owner.key();
        record.thought_id = thought_id;
        record.commitment = commitment;
        record.version = 1;
        record.status = RecordStatus::Active as u8;
        record.access_mode = access_mode;
        record.created_at = Clock::get()?.unix_timestamp;
        record.updated_at = record.created_at;
        record.bump = ctx.bumps.record;

        emit!(RecordCreated {
            owner: record.owner,
            thought_id,
            created_at: record.created_at,
        });

        Ok(())
    }

    /// Updates the policy fields a record is allowed to change. The commitment
    /// is deliberately immutable: a proof that can be rewritten is not a proof.
    pub fn update_record(ctx: Context<UpdateRecord>, access_mode: u8) -> Result<()> {
        require!(access_mode <= AccessMode::MAX, UnsaidError::InvalidAccessMode);

        let record = &mut ctx.accounts.record;
        require!(
            record.status == RecordStatus::Active as u8,
            UnsaidError::RecordNotActive
        );

        record.access_mode = access_mode;
        record.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Marks a record revoked.
    ///
    /// This is an application-level signal, not erasure. The transaction
    /// history stays visible forever, which is exactly why no content was ever
    /// written here — the honest guarantee is that there is nothing on-chain
    /// worth reading (§12.4).
    pub fn revoke_record(ctx: Context<UpdateRecord>) -> Result<()> {
        let record = &mut ctx.accounts.record;
        require!(
            record.status == RecordStatus::Active as u8,
            UnsaidError::RecordNotActive
        );

        record.status = RecordStatus::Revoked as u8;
        record.updated_at = Clock::get()?.unix_timestamp;

        emit!(RecordRevoked {
            owner: record.owner,
            thought_id: record.thought_id,
            revoked_at: record.updated_at,
        });

        Ok(())
    }

    /// Closes the record and returns its rent to the owner. The account stops
    /// existing; the historical transactions that created it do not.
    pub fn close_record(_ctx: Context<CloseRecord>) -> Result<()> {
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct ThoughtRecord {
    /// The wallet that anchored this. Optional at the product level — a user
    /// who never connects a wallet simply has no records here (§14.5).
    pub owner: Pubkey,
    /// Opaque application id. Random, and not derived from any user identity.
    pub thought_id: [u8; 32],
    /// SHA-256 over the thought id and the ciphertext hash. Not the content.
    pub commitment: [u8; 32],
    pub version: u8,
    pub status: u8,
    pub access_mode: u8,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

#[repr(u8)]
pub enum RecordStatus {
    Active = 0,
    Revoked = 1,
}

pub struct AccessMode;
impl AccessMode {
    pub const PRIVATE: u8 = 0;
    pub const SHARED_LINK: u8 = 1;
    pub const PUBLIC_PROOF: u8 = 2;
    pub const MAX: u8 = Self::PUBLIC_PROOF;
}

#[derive(Accounts)]
#[instruction(thought_id: [u8; 32])]
pub struct CreateRecord<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + ThoughtRecord::INIT_SPACE,
        // Deriving from owner + thought_id makes the address deterministic,
        // which is what gives retries idempotency for free.
        seeds = [b"thought", owner.key().as_ref(), thought_id.as_ref()],
        bump
    )]
    pub record: Account<'info, ThoughtRecord>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRecord<'info> {
    #[account(
        mut,
        // `has_one` is the authorization check: a record can only be changed by
        // the key recorded as its owner, whoever signs the transaction.
        has_one = owner @ UnsaidError::NotRecordOwner,
        seeds = [b"thought", owner.key().as_ref(), record.thought_id.as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, ThoughtRecord>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseRecord<'info> {
    #[account(
        mut,
        has_one = owner @ UnsaidError::NotRecordOwner,
        close = owner,
        seeds = [b"thought", owner.key().as_ref(), record.thought_id.as_ref()],
        bump = record.bump
    )]
    pub record: Account<'info, ThoughtRecord>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

#[event]
pub struct RecordCreated {
    pub owner: Pubkey,
    pub thought_id: [u8; 32],
    pub created_at: i64,
}

#[event]
pub struct RecordRevoked {
    pub owner: Pubkey,
    pub thought_id: [u8; 32],
    pub revoked_at: i64,
}

#[error_code]
pub enum UnsaidError {
    #[msg("The commitment must not be empty.")]
    EmptyCommitment,
    #[msg("Unknown access mode.")]
    InvalidAccessMode,
    #[msg("Only the recorded owner may modify this record.")]
    NotRecordOwner,
    #[msg("This record is not active.")]
    RecordNotActive,
}
